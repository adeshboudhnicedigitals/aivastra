package aivastra.nice.interactive.viewmodels

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.repository.TryOnRepository
import aivastra.nice.interactive.data.repository.TryOnResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MultiTryOnItemStatus {
    QUEUED,
    PROCESSING,
    COMPLETED,
    FAILED
}

data class MultiTryOnItemState(
    val product: CatalogProduct,
    val status: MultiTryOnItemStatus = MultiTryOnItemStatus.QUEUED,
    val jobId: String? = null,
    val resultUrl: String? = null,
    val errorMessage: String? = null
)

data class MultiTryOnUiState(
    val items: List<MultiTryOnItemState> = emptyList()
) {
    val completedCount: Int get() = items.count { it.status == MultiTryOnItemStatus.COMPLETED }
    val isAnyInProgress: Boolean get() = items.any {
        it.status == MultiTryOnItemStatus.QUEUED || it.status == MultiTryOnItemStatus.PROCESSING
    }
}

/**
 * Tracks N independent try-on jobs fired from one multi-garment selection, each polled on
 * its own coroutine so a slow or failed garment never blocks the others from finishing and
 * being revealed as soon as they're ready. Deliberately separate from [TryOnViewModel] (which
 * only ever tracks one job) so the existing single-garment flow — including "Try Another" —
 * is untouched by this.
 */
class MultiTryOnViewModel @JvmOverloads constructor(
    application: Application = Application(),
    private val repository: TryOnRepository = TryOnRepository()
) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(MultiTryOnUiState())
    val uiState: StateFlow<MultiTryOnUiState> = _uiState.asStateFlow()

    private val activeJobs = mutableMapOf<String, Job>()
    private var currentPhotoKey: String? = null

    /** Photo key of the running batch; lets the UI keep adding garments even if its own copy was lost. */
    val activePhotoKey: String? get() = currentPhotoKey

    companion object {
        /** Most garments one customer session may try on: 5 on the picker + 5 via "Add more looks". */
        const val MAX_SESSION_GARMENTS = 10

        // N garments poll in parallel from one IP, and the API rate-limits per IP (200/min), so
        // the cadence is kept gentle: 10 jobs at 1s would be 600 req/min and trip 429s.
        private const val FAST_POLL_WINDOW_MS = 20_000L
        private const val FAST_POLL_INTERVAL_MS = 1_500L
        private const val STEADY_POLL_INTERVAL_MS = 3_000L

        // A failed status poll says nothing about the job — it keeps running server-side. Back off
        // and keep asking instead of declaring it failed (which showed Retry on finished jobs).
        private const val MAX_BACKOFF_INTERVAL_MS = 10_000L
        private const val MAX_CONSECUTIVE_POLL_FAILURES = 40
    }

    fun startBatch(products: List<CatalogProduct>, customerPhotoKey: String) {
        cancelAllPolling()
        currentPhotoKey = customerPhotoKey
        _uiState.value = MultiTryOnUiState(
            items = products.map { MultiTryOnItemState(product = it) }
        )
        products.forEach { product -> launchJob(product, customerPhotoKey) }
    }

    /**
     * Adds one more garment to the current (or a brand-new) batch without disturbing any
     * item already there — used by "Try Another" so the customer stays on the browsing
     * screen and keeps seeing everything already generated while this one new look cooks
     * in the background, instead of being sent to a full-screen blocking loading page.
     * Re-picking the same garment replaces its old entry rather than duplicating it.
     */
    fun addItem(product: CatalogProduct, customerPhotoKey: String): Boolean {
        // Hard session cap: items are only ever cleared by resetState()/startBatch(), so the list
        // size is the number of distinct garments tried this session. Re-picking one already in
        // the list just replaces it and doesn't count as a new garment.
        val items = _uiState.value.items
        if (items.none { it.product.id == product.id } && items.size >= MAX_SESSION_GARMENTS) return false
        currentPhotoKey = customerPhotoKey
        activeJobs[product.id]?.cancel()
        _uiState.update { state ->
            val withoutExisting = state.items.filterNot { it.product.id == product.id }
            state.copy(items = withoutExisting + MultiTryOnItemState(product = product))
        }
        launchJob(product, customerPhotoKey)
        return true
    }

    /** Re-fires just one failed garment, leaving every other item's state untouched. */
    fun retryItem(productId: String) {
        val photoKey = currentPhotoKey ?: return
        val item = _uiState.value.items.firstOrNull { it.product.id == productId } ?: return
        activeJobs[productId]?.cancel()
        updateItem(productId) {
            it.copy(status = MultiTryOnItemStatus.QUEUED, jobId = null, resultUrl = null, errorMessage = null)
        }
        launchJob(item.product, photoKey)
    }

    private fun launchJob(product: CatalogProduct, customerPhotoKey: String) {
        activeJobs[product.id] = viewModelScope.launch {
            try {
                when (val result = repository.createTryOnJob(product.id, customerPhotoKey)) {
                    is TryOnResult.Success -> {
                        val jobId = result.data
                        updateItem(product.id) { it.copy(status = MultiTryOnItemStatus.PROCESSING, jobId = jobId) }
                        pollUntilDone(product.id, jobId)
                    }
                    is TryOnResult.Failure -> {
                        updateItem(product.id) {
                            it.copy(status = MultiTryOnItemStatus.FAILED, errorMessage = result.message)
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updateItem(product.id) {
                    it.copy(status = MultiTryOnItemStatus.FAILED, errorMessage = e.message ?: "Failed to start try-on")
                }
            }
        }
    }

    // Same timeout/failure-tolerance as TryOnViewModel.pollJobStatus, just scoped to one item in
    // the batch instead of the single tracked job. Polls quickly at first so a finished look
    // appears within about a second of being ready, then settles to the slower steady cadence.
    private suspend fun pollUntilDone(productId: String, jobId: String) {
        val timeoutMs = 900_000L
        var elapsedMs = 0L
        var consecutiveFailures = 0

        while (elapsedMs < timeoutMs) {
            val baseIntervalMs = if (elapsedMs < FAST_POLL_WINDOW_MS) FAST_POLL_INTERVAL_MS else STEADY_POLL_INTERVAL_MS
            // Exponential backoff while polls are failing (429s, network blips), plus a little
            // jitter so parallel items don't re-hit the API in lockstep.
            val backoffIntervalMs = if (consecutiveFailures == 0) baseIntervalMs
            else minOf(baseIntervalMs shl minOf(consecutiveFailures, 4), MAX_BACKOFF_INTERVAL_MS)
            val pollIntervalMs = backoffIntervalMs + (0L..250L).random()
            delay(pollIntervalMs)
            elapsedMs += pollIntervalMs

            when (val result = repository.checkJobStatus(jobId)) {
                is TryOnResult.Success -> {
                    consecutiveFailures = 0
                    val response = result.data
                    when (response.status.uppercase()) {
                        "COMPLETED", "SUCCESS" -> {
                            val finalUrl = response.shareUrl
                                ?: response.resultKey?.let { key ->
                                    if (key.startsWith("http")) key
                                    else "https://pub-2e9ee0f339f44a8fb927958ce786a345.r2.dev/$key"
                                }
                            if (finalUrl != null) {
                                updateItem(productId) {
                                    it.copy(status = MultiTryOnItemStatus.COMPLETED, resultUrl = finalUrl)
                                }
                            } else {
                                updateItem(productId) {
                                    it.copy(
                                        status = MultiTryOnItemStatus.FAILED,
                                        errorMessage = "Try-on completed but no result image was returned."
                                    )
                                }
                            }
                            return
                        }
                        "FAILED", "ERROR", "EXPIRED", "TIMED_OUT" -> {
                            updateItem(productId) {
                                it.copy(
                                    status = MultiTryOnItemStatus.FAILED,
                                    errorMessage = response.errorCode ?: "Try-on generation failed. Please try again."
                                )
                            }
                            return
                        }
                        "CANCELLED" -> {
                            updateItem(productId) {
                                it.copy(
                                    status = MultiTryOnItemStatus.FAILED,
                                    errorMessage = response.errorCode ?: "Try-on job cancelled"
                                )
                            }
                            return
                        }
                        else -> Unit // GENERATING, PROCESSING, PENDING... keep polling
                    }
                }
                is TryOnResult.Failure -> {
                    consecutiveFailures++
                    if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                        updateItem(productId) {
                            it.copy(status = MultiTryOnItemStatus.FAILED, errorMessage = result.message)
                        }
                        return
                    }
                }
            }
        }

        updateItem(productId) {
            it.copy(status = MultiTryOnItemStatus.FAILED, errorMessage = "Try-on generation timed out. Please try again.")
        }
    }

    private fun updateItem(productId: String, transform: (MultiTryOnItemState) -> MultiTryOnItemState) {
        _uiState.update { state ->
            state.copy(items = state.items.map { if (it.product.id == productId) transform(it) else it })
        }
    }

    private fun cancelAllPolling() {
        activeJobs.values.forEach { it.cancel() }
        activeJobs.clear()
    }

    fun resetState() {
        cancelAllPolling()
        currentPhotoKey = null
        _uiState.value = MultiTryOnUiState()
    }

    override fun onCleared() {
        cancelAllPolling()
        super.onCleared()
    }
}

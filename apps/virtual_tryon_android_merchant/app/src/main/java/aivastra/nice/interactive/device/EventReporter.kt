package aivastra.nice.interactive.device

import aivastra.nice.interactive.api.ApiClient
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.IOException

/**
 * Records tablet analytics events (the ANALYTICS_CLIENT_EVENTS allowlist in
 * packages/types/src/analytics-events.ts) and uploads them in the background. Recording never
 * blocks or fails the UI: it appends to a file, and the uploader drains it every 30s and at
 * session end (device-mode plan, M5). Server-side events (session start/end, try-on, sale)
 * are written by the API itself and are never sent from here.
 */
object EventReporter {
    private const val FLUSH_EVERY_MS = 30_000L
    private const val MAX_BACKOFF_MS = 5 * 60_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flushLock = Mutex()
    private lateinit var queue: EventQueueCore
    @Volatile private var backoffMs = 0L

    fun initialize(context: Context) {
        queue = EventQueueCore(File(context.applicationContext.filesDir, "analytics-events.jsonl"))
        scope.launch {
            while (isActive) {
                delay(FLUSH_EVERY_MS + backoffMs)
                flush()
            }
        }
    }

    fun itemViewed(catalogItemId: String, props: Map<String, Any>? = null) =
        record("item_viewed", catalogItemId = catalogItemId, props = props)

    fun categoryViewed(category: String) = record("category_viewed", props = mapOf("category" to category))

    fun qrShown(purpose: String) = record("qr_shown", props = mapOf("purpose" to purpose))

    /** No client event: the server writes session_started. Here only to flush the queue early. */
    internal fun sessionStarted() = flushSoon()

    fun flushSoon() {
        if (::queue.isInitialized) scope.launch { flush() }
    }

    private fun record(event: String, catalogItemId: String? = null, props: Map<String, Any>? = null) {
        if (!::queue.isInitialized || !DeviceStore.paired.value) return
        scope.launch {
            queue.append(
                QueuedEvent(
                    event = event,
                    sessionId = InstoreSession.id,
                    catalogItemId = catalogItemId,
                    props = props,
                ),
            )
        }
    }

    private suspend fun flush() = flushLock.withLock {
        if (!DeviceStore.paired.value) return@withLock
        while (true) {
            val outcome = queue.flushOnce { batch -> send(batch) } ?: break
            when (outcome) {
                UploadOutcome.DONE, UploadOutcome.INVALID -> backoffMs = 0L
                UploadOutcome.RETRY -> {
                    backoffMs = (backoffMs * 2).coerceIn(FLUSH_EVERY_MS, MAX_BACKOFF_MS)
                    break
                }
                UploadOutcome.UNAUTHORIZED -> break
            }
        }
    }

    private suspend fun send(batch: List<QueuedEvent>): UploadOutcome =
        try {
            val res = ApiClient.deviceApi.uploadEvents(EventsBatchRequest(batch))
            when {
                res.isSuccessful -> UploadOutcome.DONE
                res.code() == 400 -> UploadOutcome.INVALID
                res.code() == 401 -> UploadOutcome.UNAUTHORIZED
                else -> UploadOutcome.RETRY
            }
        } catch (_: IOException) {
            UploadOutcome.RETRY
        }
}

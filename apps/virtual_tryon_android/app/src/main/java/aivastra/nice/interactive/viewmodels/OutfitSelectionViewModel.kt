package aivastra.nice.interactive.viewmodels

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.models.GarmentSubcategory
import aivastra.nice.interactive.data.repository.CatalogRepository
import aivastra.nice.interactive.data.repository.CatalogResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

data class OutfitSelectionUiState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val category: String = "",
    val subcategories: List<GarmentSubcategory> = emptyList(),
    val products: List<CatalogProduct> = emptyList(),
    val selectedSubcategoryId: String? = null,
    val errorMessage: String? = null,
    val isUnauthorized: Boolean = false
) {
    val visibleProducts: List<CatalogProduct>
        get() = selectedSubcategoryId?.let { id ->
            products.filter { it.subcategoryId == id }
        } ?: products
}

/** Same rule as the server's `search` param: substring of label or SKU, case-insensitive. */
fun List<CatalogProduct>.matchingSearch(query: String): List<CatalogProduct> {
    val term = query.trim()
    if (term.isEmpty()) return this
    return filter {
        it.label?.contains(term, ignoreCase = true) == true ||
            it.sku?.contains(term, ignoreCase = true) == true
    }
}

class OutfitSelectionViewModel(
    private val repository: CatalogRepository = CatalogRepository()
) : ViewModel() {
    private val _uiState = MutableStateFlow(OutfitSelectionUiState())
    val uiState: StateFlow<OutfitSelectionUiState> = _uiState.asStateFlow()

    private var catalogJob: Job? = null

    // Compose state rather than a field on the StateFlow: a TextField bound to a
    // collected flow gets its value back a dispatch late, which drops characters
    // and jumps the cursor on fast typing.
    var searchQuery by mutableStateOf("")
        private set

    fun onSearchQueryChange(query: String) {
        // Starting a search widens the scope to the whole category, so a name or
        // SKU is found even when it sits under a chip other than the selected one.
        // Chips stay tappable afterwards to narrow the results.
        if (searchQuery.isBlank() && query.isNotBlank()) {
            _uiState.update { it.copy(selectedSubcategoryId = null) }
        }
        searchQuery = query
    }

    fun loadCatalog(category: String, forceReload: Boolean = false) {
        val normalizedCategory = category.trim().lowercase()
        val currentState = _uiState.value

        val shouldForceReload = forceReload || currentState.products.isEmpty()

        if (!shouldForceReload && currentState.category == normalizedCategory && currentState.products.isNotEmpty()) {
            _uiState.update { it.copy(isLoading = false, isRefreshing = false) }
            return
        }

        catalogJob?.cancel()

        if (currentState.category != normalizedCategory) searchQuery = ""

        val hasExistingContent =
            currentState.category == normalizedCategory && currentState.products.isNotEmpty()

        _uiState.update { state ->
            if (hasExistingContent) {
                state.copy(
                    isLoading = false,
                    isRefreshing = true,
                    category = normalizedCategory,
                    errorMessage = null,
                    isUnauthorized = false
                )
            } else {
                OutfitSelectionUiState(
                    isLoading = true,
                    category = normalizedCategory,
                    errorMessage = null,
                    isUnauthorized = false
                )
            }
        }

        catalogJob = viewModelScope.launch {
            try {
                val result = withTimeoutOrNull(20000L) {
                    repository.getCatalog(normalizedCategory, shouldForceReload)
                }

                if (result == null) {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            isRefreshing = false,
                            errorMessage = "Loading timed out. Check connection and tap Retry.",
                            isUnauthorized = false
                        )
                    }
                } else {
                    when (result) {
                        is CatalogResult.Success -> _uiState.update { state ->
                            // A refresh mid-search must not snap "All" back to the
                            // first chip and silently narrow the results.
                            val keepAll = searchQuery.isNotBlank() && state.selectedSubcategoryId == null
                            val selectedSubcategoryId = if (keepAll) null else resolveSelectedSubcategoryId(
                                subcategories = result.data.subcategories,
                                products = result.data.products,
                                preferredId = state.selectedSubcategoryId
                            )
                            state.copy(
                                isLoading = false,
                                isRefreshing = false,
                                category = normalizedCategory,
                                subcategories = result.data.subcategories,
                                products = result.data.products,
                                selectedSubcategoryId = selectedSubcategoryId,
                                errorMessage = null,
                                isUnauthorized = false
                            )
                        }

                        is CatalogResult.Failure -> _uiState.update { state ->
                            state.copy(
                                isLoading = false,
                                isRefreshing = false,
                                errorMessage = result.message,
                                isUnauthorized = result.isUnauthorized
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = e.message ?: "Failed to load catalog. Tap Retry.",
                        isUnauthorized = false
                    )
                }
            }
        }
    }

    fun retry() {
        val category = _uiState.value.category
        if (category.isNotBlank()) {
            CatalogRepository.clearCache()
            loadCatalog(category, forceReload = true)
        }
    }

    fun refresh() {
        retry()
    }

    fun selectSubcategory(id: String?) {
        _uiState.update { it.copy(selectedSubcategoryId = id) }
    }

    private fun resolveSelectedSubcategoryId(
        subcategories: List<GarmentSubcategory>,
        products: List<CatalogProduct>,
        preferredId: String?
    ): String? {
        val productSubcategoryIds = products.mapTo(hashSetOf()) { it.subcategoryId }

        if (preferredId != null && preferredId in productSubcategoryIds) {
            return preferredId
        }

        return subcategories
            .firstOrNull { it.id in productSubcategoryIds }
            ?.id
    }
}

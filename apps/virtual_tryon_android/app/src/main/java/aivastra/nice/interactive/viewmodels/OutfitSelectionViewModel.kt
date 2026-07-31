package aivastra.nice.interactive.viewmodels

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
    val category: String = "",
    val subcategories: List<GarmentSubcategory> = emptyList(),
    val products: List<CatalogProduct> = emptyList(),
    val selectedSubcategoryId: String? = null,
    val errorMessage: String? = null
) {
    val visibleProducts: List<CatalogProduct>
        get() = selectedSubcategoryId?.let { id ->
            products.filter { it.subcategoryId == id }
        } ?: products
}

class OutfitSelectionViewModel(
    private val repository: CatalogRepository = CatalogRepository()
) : ViewModel() {
    private val _uiState = MutableStateFlow(OutfitSelectionUiState())
    val uiState: StateFlow<OutfitSelectionUiState> = _uiState.asStateFlow()

    private var catalogJob: Job? = null

    fun loadCatalog(category: String, forceReload: Boolean = false) {
        val normalizedCategory = category.trim().lowercase()

        // If products for this category are already loaded and not forcing reload, return loaded state
        if (!forceReload && _uiState.value.category == normalizedCategory && _uiState.value.products.isNotEmpty()) {
            _uiState.update { it.copy(isLoading = false) }
            return
        }

        // Cancel previous loading job to prevent race conditions or infinite loading traps
        catalogJob?.cancel()

        _uiState.update {
            OutfitSelectionUiState(
                isLoading = true,
                category = normalizedCategory,
                errorMessage = null
            )
        }

        catalogJob = viewModelScope.launch {
            val result = withTimeoutOrNull(20000L) {
                repository.getCatalog(normalizedCategory, forceReload)
            }

            if (result == null) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Loading timed out. Check connection and tap Retry."
                    )
                }
            } else {
                when (result) {
                    is CatalogResult.Success -> _uiState.update {
                        val firstId = result.data.subcategories.firstOrNull()?.id
                        it.copy(
                            isLoading = false,
                            category = normalizedCategory,
                            subcategories = result.data.subcategories,
                            products = result.data.products,
                            selectedSubcategoryId = firstId,
                            errorMessage = null
                        )
                    }
                    is CatalogResult.Failure -> _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = result.message
                        )
                    }
                }
            }
        }
    }

    fun retry() {
        val category = _uiState.value.category
        if (category.isNotBlank()) {
            loadCatalog(category, forceReload = true)
        }
    }

    fun selectSubcategory(id: String?) {
        _uiState.update { it.copy(selectedSubcategoryId = id) }
    }
}

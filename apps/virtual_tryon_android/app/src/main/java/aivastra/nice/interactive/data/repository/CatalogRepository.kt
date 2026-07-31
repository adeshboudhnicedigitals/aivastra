package aivastra.nice.interactive.data.repository

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.api.ApiService
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.models.GarmentSubcategory
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class CatalogData(
    val subcategories: List<GarmentSubcategory>,
    val products: List<CatalogProduct>
)

sealed interface CatalogResult {
    data class Success(val data: CatalogData) : CatalogResult
    data class Failure(val message: String) : CatalogResult
}

// Process-wide cache: merchant-wide catalog caching
private object CatalogCache {
    private const val TTL_MILLIS = 5 * 60 * 1000L

    val productsMutex = Mutex()
    var products: List<CatalogProduct>? = null
    var productsFetchedAt: Long = 0L

    val subcategoriesMutex = Mutex()
    val subcategoriesByCategory = mutableMapOf<String, List<GarmentSubcategory>>()
    val subcategoriesFetchedAtByCategory = mutableMapOf<String, Long>()

    fun isFresh(fetchedAt: Long) = fetchedAt != 0L && (System.currentTimeMillis() - fetchedAt) < TTL_MILLIS

    fun invalidate() {
        products = null
        productsFetchedAt = 0L
        subcategoriesByCategory.clear()
        subcategoriesFetchedAtByCategory.clear()
    }
}

class CatalogRepository(
    private val service: ApiService = ApiClient.apiService
) {
    suspend fun getCatalog(category: String, forceReload: Boolean = false): CatalogResult {
        if (forceReload) CatalogCache.invalidate()

        return try {
            supervisorScope {
                val subcategoriesDeferred = async { loadSubcategories(category) }
                val productsDeferred = async { loadProducts() }

                val subcategories = subcategoriesDeferred.await()
                val products = productsDeferred.await()

                if (subcategories == null || products == null) {
                    return@supervisorScope CatalogResult.Failure(
                        "Unable to load catalog. Please check connection and tap Retry."
                    )
                }

                val validIds = subcategories.mapTo(hashSetOf()) { it.id }
                val filteredProducts = products
                    .filter {
                        it.subcategoryId in validIds &&
                            it.isActive &&
                            it.moderationStatus.equals("approved", ignoreCase = true)
                    }
                    .sortedBy { it.sortOrder }

                CatalogResult.Success(CatalogData(subcategories, filteredProducts))
            }
        } catch (exception: Exception) {
            CatalogResult.Failure(
                exception.message ?: "Network error. Check your connection and retry."
            )
        }
    }

    private suspend fun loadProducts(): List<CatalogProduct>? {
        CatalogCache.products?.takeIf { CatalogCache.isFresh(CatalogCache.productsFetchedAt) }?.let { return it }

        return try {
            CatalogCache.productsMutex.withLock {
                val cached = CatalogCache.products?.takeIf { CatalogCache.isFresh(CatalogCache.productsFetchedAt) }
                if (cached != null) {
                    cached
                } else {
                    val response = service.getCatalog(includeDemo = true)
                    if (!response.isSuccessful) {
                        null
                    } else {
                        val items = response.body()?.items.orEmpty()
                        CatalogCache.products = items
                        CatalogCache.productsFetchedAt = System.currentTimeMillis()
                        items
                    }
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun loadSubcategories(category: String): List<GarmentSubcategory>? {
        CatalogCache.subcategoriesByCategory[category]
            ?.takeIf { CatalogCache.isFresh(CatalogCache.subcategoriesFetchedAtByCategory[category] ?: 0L) }
            ?.let { return it }

        return try {
            CatalogCache.subcategoriesMutex.withLock {
                val cached = CatalogCache.subcategoriesByCategory[category]
                    ?.takeIf { CatalogCache.isFresh(CatalogCache.subcategoriesFetchedAtByCategory[category] ?: 0L) }
                if (cached != null) {
                    cached
                } else {
                    val response = service.getSubcategories(category, includeDemo = true)
                    if (!response.isSuccessful) {
                        null
                    } else {
                        val items = response.body()?.items.orEmpty()
                            .filter { it.productCount > 0 }
                            .sortedBy { it.sortOrder }
                        CatalogCache.subcategoriesByCategory[category] = items
                        CatalogCache.subcategoriesFetchedAtByCategory[category] = System.currentTimeMillis()
                        items
                    }
                }
            }
        } catch (e: Exception) {
            null
        }
    }
}

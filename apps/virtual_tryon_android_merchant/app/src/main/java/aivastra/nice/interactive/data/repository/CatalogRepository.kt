package aivastra.nice.interactive.data.repository

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.api.ApiService
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.models.GarmentSubcategory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

import aivastra.nice.interactive.data.session.SessionManager

data class CatalogData(
    val subcategories: List<GarmentSubcategory>,
    val products: List<CatalogProduct>
)

sealed interface CatalogResult {
    data class Success(val data: CatalogData) : CatalogResult
    data class Failure(val message: String, val isUnauthorized: Boolean = false) : CatalogResult
}

// Custom exception for clean exception propagation within supervisorScope
private class CatalogUnauthorizedException(message: String = "Session expired. Please sign in again.") : Exception(message)

// Process-wide cache: merchant-wide catalog caching.
//
// `fetchLock` serializes field reads/writes themselves — invalidate() can be called from a plain
// (non-suspend) context (SessionManager.save()/clear() on login/logout) at the same moment another
// coroutine is mid-write inside productsMutex/subcategoriesMutex below, since neither of those is
// held while invalidate() runs. Without this, a logout racing an in-flight catalog fetch could tear
// a map write mid-iteration (ConcurrentModificationException) or leave products/subcategories out of
// sync with each other. fetchLock is only ever held across plain field access, never across a
// suspend point, so a plain JVM monitor is correct here — unlike productsMutex/subcategoriesMutex
// below, which guard the network fetch itself and must stay coroutine-aware (Mutex) so they don't
// block a thread while awaiting the response.
private object CatalogCache {
    private const val TTL_MILLIS = 5 * 60 * 1000L
    private val fetchLock = Any()

    val productsMutex = Mutex()
    val subcategoriesMutex = Mutex()

    private var products: List<CatalogProduct>? = null
    private var productsFetchedAt: Long = 0L
    private val subcategoriesByCategory = mutableMapOf<String, List<GarmentSubcategory>>()
    private val subcategoriesFetchedAtByCategory = mutableMapOf<String, Long>()

    private fun isFresh(fetchedAt: Long) = fetchedAt != 0L && (System.currentTimeMillis() - fetchedAt) < TTL_MILLIS

    fun productsFresh(): Boolean = synchronized(fetchLock) {
        products != null && isFresh(productsFetchedAt)
    }

    fun freshProducts(): List<CatalogProduct>? = synchronized(fetchLock) {
        products?.takeIf { isFresh(productsFetchedAt) }
    }

    // Pass null (or an empty list) to mark as "not cached" — callers rely on this to avoid
    // caching an empty result as fresh data, so newly granted access still fetches a fresh catalog.
    fun storeProducts(items: List<CatalogProduct>?) = synchronized(fetchLock) {
        val nonEmpty = items?.takeIf { it.isNotEmpty() }
        products = nonEmpty
        productsFetchedAt = if (nonEmpty != null) System.currentTimeMillis() else 0L
    }

    fun subcategoriesFresh(category: String): Boolean = synchronized(fetchLock) {
        subcategoriesByCategory[category] != null && isFresh(subcategoriesFetchedAtByCategory[category] ?: 0L)
    }

    fun freshSubcategories(category: String): List<GarmentSubcategory>? = synchronized(fetchLock) {
        subcategoriesByCategory[category]?.takeIf { isFresh(subcategoriesFetchedAtByCategory[category] ?: 0L) }
    }

    fun storeSubcategories(category: String, items: List<GarmentSubcategory>?) = synchronized(fetchLock) {
        val nonEmpty = items?.takeIf { it.isNotEmpty() }
        if (nonEmpty != null) {
            subcategoriesByCategory[category] = nonEmpty
            subcategoriesFetchedAtByCategory[category] = System.currentTimeMillis()
        } else {
            subcategoriesByCategory.remove(category)
            subcategoriesFetchedAtByCategory.remove(category)
        }
    }

    fun invalidate() = synchronized(fetchLock) {
        products = null
        productsFetchedAt = 0L
        subcategoriesByCategory.clear()
        subcategoriesFetchedAtByCategory.clear()
    }
}

class CatalogRepository(
    private val service: ApiService = ApiClient.apiService
) {
    companion object {
        fun clearCache() {
            CatalogCache.invalidate()
        }
    }

    suspend fun getCatalog(category: String, forceReload: Boolean = false): CatalogResult {
        val shouldForce = forceReload ||
            !CatalogCache.subcategoriesFresh(category) ||
            !CatalogCache.productsFresh()
        if (shouldForce) {
            CatalogCache.invalidate()
        }

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
        } catch (unauthorized: CatalogUnauthorizedException) {
            CatalogCache.invalidate()
            SessionManager.clear()
            CatalogResult.Failure(
                unauthorized.message ?: "Session expired. Please sign in again.",
                isUnauthorized = true
            )
        } catch (e: CancellationException) {
            throw e
        } catch (exception: Exception) {
            CatalogResult.Failure(
                exception.message ?: "Network error. Check your connection and retry."
            )
        }
    }

    private suspend fun loadProducts(): List<CatalogProduct>? {
        CatalogCache.freshProducts()?.let { return it }

        return try {
            CatalogCache.productsMutex.withLock {
                val cached = CatalogCache.freshProducts()
                if (cached != null) {
                    cached
                } else {
                    val response = service.getCatalog(includeDemo = true)
                    if (!response.isSuccessful) {
                        if (response.code() in listOf(400, 401, 403)) {
                            throw CatalogUnauthorizedException()
                        }
                        null
                    } else {
                        val items = response.body()?.items.orEmpty()
                        CatalogCache.storeProducts(items)
                        items
                    }
                }
            }
        } catch (e: Exception) {
            if (e is CatalogUnauthorizedException || e is CancellationException) throw e
            null
        }
    }

    private suspend fun loadSubcategories(category: String): List<GarmentSubcategory>? {
        CatalogCache.freshSubcategories(category)?.let { return it }

        return try {
            CatalogCache.subcategoriesMutex.withLock {
                val cached = CatalogCache.freshSubcategories(category)
                if (cached != null) {
                    cached
                } else {
                    val response = service.getSubcategories(category, includeDemo = true)
                    if (!response.isSuccessful) {
                        if (response.code() in listOf(400, 401, 403)) {
                            throw CatalogUnauthorizedException()
                        }
                        null
                    } else {
                        val items = response.body()?.items.orEmpty()
                            .filter { it.productCount > 0 }
                            .sortedBy { it.sortOrder }
                        CatalogCache.storeSubcategories(category, items)
                        items
                    }
                }
            }
        } catch (e: Exception) {
            if (e is CatalogUnauthorizedException || e is CancellationException) throw e
            null
        }
    }
}

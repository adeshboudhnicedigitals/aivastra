package aivastra.nice.aivastraadmin.viewmodels

import aivastra.nice.aivastraadmin.utils.PrefsManager
import com.example.facewixlatest.ApiUtils.APICaller
import com.example.facewixlatest.ApiUtils.APIConstant
import com.fasterxml.jackson.databind.ObjectMapper

object MerchantCatalogRepository {
    private val mapper = ObjectMapper()
    suspend fun fetchSubcategories(category: String): List<MerchantCatalogSubcategory> {
        val response = APICaller.getJsonAuthed("${APIConstant.API_ENDPOINTS.MERCHANT_CATALOG_SUBCATEGORIES}?category=$category", PrefsManager.getAccessToken())
        return mapper.readValue(response, MerchantCatalogSubcategoryListResponse::class.java).items
    }
    suspend fun fetchItems(subcategoryId: String? = null, search: String? = null): List<MerchantCatalogItem> {
        val params = buildList { subcategoryId?.let { add("subcategoryId=$it") }; search?.takeIf { it.isNotBlank() }?.let { add("search=${java.net.URLEncoder.encode(it, "UTF-8")}") } }
        val response = APICaller.getJsonAuthed("${APIConstant.API_ENDPOINTS.MERCHANT_CATALOG_ITEMS}${if (params.isEmpty()) "" else "?${params.joinToString("&")}"}", PrefsManager.getAccessToken())
        return mapper.readValue(response, MerchantCatalogListResponse::class.java).items
    }
}
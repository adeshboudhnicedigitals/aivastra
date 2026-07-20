package aivastra.nice.aivastraadmin.viewmodels

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class MerchantCatalogSubcategory(@JsonProperty("id") val id: String = "", @JsonProperty("category") val category: String = "", @JsonProperty("name") val name: String = "", @JsonProperty("productCount") val productCount: Int = 0) : Serializable
@JsonIgnoreProperties(ignoreUnknown = true)
data class MerchantCatalogSubcategoryListResponse(@JsonProperty("items") val items: List<MerchantCatalogSubcategory> = emptyList())
@JsonIgnoreProperties(ignoreUnknown = true)
data class MerchantCatalogItem(@JsonProperty("id") val id: String = "", @JsonProperty("subcategoryId") val subcategoryId: String = "", @JsonProperty("label") val label: String = "", @JsonProperty("sku") val sku: String? = null, @JsonProperty("actualPrice") val actualPrice: Int = 0, @JsonProperty("offerPrice") val offerPrice: Int = 0, @JsonProperty("imageUrl") val imageUrl: String? = null, @JsonProperty("thumbnailUrl") val thumbnailUrl: String? = null) : Serializable
@JsonIgnoreProperties(ignoreUnknown = true)
data class MerchantCatalogListResponse(@JsonProperty("items") val items: List<MerchantCatalogItem> = emptyList())
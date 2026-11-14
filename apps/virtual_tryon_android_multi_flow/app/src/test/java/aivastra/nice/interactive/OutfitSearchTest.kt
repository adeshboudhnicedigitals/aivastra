package aivastra.nice.interactive

import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.viewmodels.matchingSearch
import org.junit.Assert.assertEquals
import org.junit.Test

class OutfitSearchTest {
    private fun product(label: String?, sku: String? = null) = CatalogProduct(
        id = label ?: "none",
        merchantId = "m",
        subcategoryId = "s",
        label = label,
        sku = sku,
        moderationStatus = "approved",
        imageUrl = null,
        thumbnailUrl = null,
    )

    private val items = listOf(
        product("Cotton Shirt - Red", "SH-1"),
        product("Red Silk Shirt", "SH-2"),
        product("Red Trousers", "TR-1"),
        product("Blue Shirt", "SH-3"),
    )

    private fun search(q: String) = items.matchingSearch(q).map { it.label }

    @Test
    fun everyWordMustMatchInAnyOrder() {
        assertEquals(listOf("Cotton Shirt - Red", "Red Silk Shirt"), search("red shirt"))
        assertEquals(search("red shirt"), search("shirt red"))
    }

    @Test
    fun matchesPartialWordsCaseInsensitivelyIgnoringExtraSpaces() {
        assertEquals(listOf("Red Silk Shirt"), search("  RED   sh-2 "))
        assertEquals(listOf("Blue Shirt"), search("blu"))
    }

    @Test
    fun wordsMayMatchLabelAndSkuSeparately() {
        assertEquals(listOf("Red Trousers"), search("red tr-1"))
    }

    @Test
    fun noMatchGivesEmptyAndBlankKeepsEverything() {
        assertEquals(emptyList<String>(), search("green shirt"))
        assertEquals(items.size, items.matchingSearch("   ").size)
        assertEquals(items.size, items.matchingSearch("").size)
    }

    @Test
    fun nullLabelAndSkuNeverMatchButDoNotCrash() {
        assertEquals(emptyList<String?>(), listOf(product(null)).matchingSearch("red").map { it.label })
    }
}

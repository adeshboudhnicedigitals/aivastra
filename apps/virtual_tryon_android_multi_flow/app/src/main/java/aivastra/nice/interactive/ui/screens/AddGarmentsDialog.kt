package aivastra.nice.interactive.ui.screens

import androidx.compose.runtime.Composable
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.viewmodels.MultiTryOnItemState

/**
 * Lets the customer add more garments to the current batch without ever leaving the results
 * grid behind it. It hosts the same [OutfitSelectionPage] used for the first pick — same
 * carousel/grid, per-garment timers and swipe button — inside a dialog, so picking here never
 * leaves [MultiTryOnResultsPage]. Back (and the swipe button) simply close the dialog and
 * return to the generation page; garments already in [generatedItems] show as checked.
 */
@Composable
fun AddGarmentsDialog(
    category: String,
    generatedItems: List<MultiTryOnItemState>,
    onDismiss: () -> Unit,
    onGenerate: (List<CatalogProduct>) -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        OutfitSelectionPage(
            category = category,
            onBack = onDismiss,
            onUnauthorized = onDismiss,
            generatedItems = generatedItems,
            onGenerate = onGenerate,
            onViewResults = onDismiss
        )
    }
}

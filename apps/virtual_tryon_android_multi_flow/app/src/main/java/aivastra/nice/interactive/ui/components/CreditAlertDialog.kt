package aivastra.nice.interactive.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import aivastra.nice.interactive.data.repository.PlanRepository
import aivastra.nice.interactive.utils.CrashReporter
import aivastra.nice.interactive.utils.CreditAlert
import aivastra.nice.interactive.utils.CreditBalanceTracker

/**
 * Checks the merchant's balance whenever [refreshKey] changes (a new try-on result) and
 * shows a dismissible heads-up when it just fell below the low-credit level or hit zero.
 * Informational only: Play Store treats in-app "buy credits" prompts as a digital-goods
 * flow that must use Play Billing, so the action only opens the AI Vastra account site,
 * the same as the "insufficient credits" dialog on the processing screen. Balance comes from
 * `/v1/credits` via [PlanRepository], the same source as the home plan card.
 */
@Composable
fun CreditAlertGate(refreshKey: Any?) {
    val context = LocalContext.current
    var alert by remember { mutableStateOf<CreditAlert?>(null) }
    var balance by remember { mutableStateOf(0) }

    LaunchedEffect(refreshKey) {
        // A failed lookup (null) shows nothing rather than an error over the result.
        val summary = PlanRepository().getSummary()
        if (summary != null) {
            balance = summary.balance
            CreditBalanceTracker.update(summary.balance)?.let { alert = it }
        }
    }

    val shown = alert ?: return
    val exhausted = shown == CreditAlert.EXHAUSTED
    AppDialog(
        title = if (exhausted) "You've run out of credits" else "Your credits are running low",
        message = if (exhausted) {
            "Your credit balance is now 0, so new try-ons will not run until credits are added to your account. Please sign in to your AI Vastra account to manage your account."
        } else {
            "You have $balance credit${if (balance == 1) "" else "s"} left. Please sign in to your AI Vastra account to manage your account."
        },
        icon = Icons.Default.Warning,
        confirmText = "Open AI Vastra",
        cancelText = "Dismiss",
        onConfirm = {
            alert = null
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.aivastra.com")))
            } catch (e: Exception) {
                CrashReporter.recordException(e, "CreditAlertDialog")
            }
        },
        onDismiss = { alert = null }
    )
}

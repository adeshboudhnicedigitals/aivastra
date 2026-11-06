package aivastra.nice.interactive.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.data.models.RenewalPromptResponse
import aivastra.nice.interactive.ui.components.RenewalPromptDialog
import aivastra.nice.interactive.utils.CrashReporter

// Screens with no signed-in merchant yet, plus the pricing WebView the popup itself
// opens: asking there would either fail (no session) or cover the payment page.
private val UNGATED_ROUTES = setOf(
    Screen.Splash.route,
    Screen.SignIn.route,
    Screen.Onboarding.route,
    Screen.PendingActivation.route,
    Screen.ManageCredits.route
)

/**
 * "Subscription expired" popup over every signed-in screen. Asks the server on each app
 * resume and each time the user lands back on a signed-in screen — notably on returning
 * from Manage Credits, so a user who has just paid never sees it again. Fails open: any
 * network/API error simply shows nothing, so an outage never locks users out.
 *
 * Blocking mode (server-controlled) can't be dismissed; renewing and the support
 * contacts are the only ways forward. This is app-side only — the API does not refuse
 * jobs for these users.
 */
@Composable
fun RenewalPromptGate(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route
    val gated = route != null && route !in UNGATED_ROUTES

    var prompt by remember { mutableStateOf<RenewalPromptResponse?>(null) }
    var dismissed by remember { mutableStateOf(false) }
    var resumeTick by remember { mutableIntStateOf(0) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) resumeTick++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Keyed on `gated` (not the route) so moving between signed-in screens doesn't
    // re-ask on every tap; entering signed-in territory or resuming does.
    LaunchedEffect(gated, resumeTick) {
        if (!gated) {
            prompt = null
            return@LaunchedEffect
        }
        dismissed = false
        prompt = try {
            val res = ApiClient.apiService.getRenewalPrompt()
            res.body()?.takeIf { res.isSuccessful && it.show }
        } catch (e: Exception) {
            CrashReporter.recordException(e, "RenewalPromptGate")
            null
        }
    }

    val current = prompt
    if (!gated || current == null || dismissed) return

    RenewalPromptDialog(
        title = current.title ?: "Subscription Expired!",
        message = current.message,
        ctaLabel = current.ctaLabel ?: "Click Here to Renew",
        supportWhatsapp = current.supportWhatsapp,
        supportEmail = current.supportEmail,
        blocking = current.blocking != false,
        onRenew = {
            prompt = null
            navController.navigate(Screen.ManageCredits.route) { launchSingleTop = true }
        },
        onLater = { dismissed = true }
    )
}

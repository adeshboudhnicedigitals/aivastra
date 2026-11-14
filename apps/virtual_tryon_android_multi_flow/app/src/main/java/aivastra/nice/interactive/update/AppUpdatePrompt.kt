package aivastra.nice.interactive.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import aivastra.nice.interactive.BuildConfig
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.data.models.AppUpdatePromptResponse
import aivastra.nice.interactive.ui.components.AppDialog
import kotlinx.coroutines.CancellationException

private const val TAG = "AppUpdatePrompt"

// Set when the user taps "Later". Process-wide on purpose: it survives the composable
// being recreated (rotation) and a foreground return, but not a fresh launch — so the
// popup comes back every time the app is opened, without re-nagging mid-session.
private var dismissedThisLaunch = false

/**
 * Asks our own API (not Play's in-app-update API) whether a newer build exists, by
 * sending [BuildConfig.VERSION_CODE]. Play's API depends on per-device Play state, which
 * skips some devices and can keep offering a build that is already installed; comparing
 * version codes on the server does neither. The latest code, on/off switch and copy are
 * all set from the admin panel.
 *
 * Soft update only: "Later" closes it until the next launch. Any failure shows nothing,
 * so a server outage never nags or blocks a user.
 */
@Composable
fun AppUpdatePrompt() {
    val context = LocalContext.current
    var prompt by remember { mutableStateOf<AppUpdatePromptResponse?>(null) }
    var checkTick by remember { mutableIntStateOf(0) }

    // Re-check on each return to the foreground; the first ON_RESUME covers cold start.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) checkTick++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(checkTick) {
        if (checkTick == 0 || dismissedThisLaunch) return@LaunchedEffect
        prompt = try {
            val response = ApiClient.apiService.getAppUpdatePrompt(BuildConfig.VERSION_CODE)
            response.body()?.takeIf { response.isSuccessful && it.show }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Update check failed", e)
            null
        }
    }

    val active = prompt ?: return
    if (dismissedThisLaunch) return
    AppDialog(
        title = active.title.orEmpty(),
        message = active.message,
        icon = Icons.Default.Refresh,
        confirmText = active.ctaLabel ?: "Update now",
        cancelText = "Later",
        onConfirm = { openPlayStore(context) },
        onDismiss = {
            dismissedThisLaunch = true
            prompt = null
        }
    )
}

// Prefer the Play Store app; fall back to the web listing when it isn't installed
// (some kiosk tablets ship without it).
private fun openPlayStore(context: Context) {
    val pkg = context.packageName
    val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(market)
    } catch (e: ActivityNotFoundException) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e2: ActivityNotFoundException) {
            Log.w(TAG, "No app can open the Play Store listing", e2)
        }
    }
}

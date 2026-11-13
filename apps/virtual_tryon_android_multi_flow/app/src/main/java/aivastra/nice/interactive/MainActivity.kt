package aivastra.nice.interactive

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.core.view.WindowCompat
import androidx.navigation.compose.rememberNavController
import aivastra.nice.interactive.camera.kioskReversePortraitOrientation
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.navigation.AppNavGraph
import aivastra.nice.interactive.ui.components.NoInternetBanner
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.update.InAppUpdateChecker

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Overrides the manifest's `portrait` only on the natively-landscape kiosk panel whose
        // system rotation is 90, where plain portrait would flip the screen 180 degrees.
        // The camera enumeration behind it blocked the main thread for hundreds of ms at launch, so
        // launch applies the last computed answer and a background pass refreshes it.
        val prefs = getSharedPreferences("orientation_cache", MODE_PRIVATE)
        val cached = prefs.getInt("kiosk_orientation", NO_ORIENTATION)
        if (cached != NO_ORIENTATION) requestedOrientation = cached
        Thread {
            val fresh = kioskReversePortraitOrientation(applicationContext) ?: NO_ORIENTATION
            prefs.edit().putInt("kiosk_orientation", fresh).apply()
            if (fresh != cached) runOnUiThread {
                if (!isFinishing && !isDestroyed) {
                    requestedOrientation = if (fresh == NO_ORIENTATION) {
                        android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    } else fresh
                }
            }
        }.start()
        window.setBackgroundDrawableResource(android.R.color.black)
        SessionManager.initialize(applicationContext)

        // Enable edge-to-edge with transparent status bar and white status bar icons
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )

        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            AiVastraTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = ComposeColor.Black
                ) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        val navController = rememberNavController()

                        AppNavGraph(
                            navController = navController,
                            modifier = Modifier.fillMaxSize()
                        )

                        InAppUpdateChecker()

                        // Observes NetworkMonitor directly and lives above every screen, so
                        // connectivity loss/recovery is visible app-wide without each screen
                        // wiring its own check.
                        NoInternetBanner(modifier = Modifier.align(Alignment.TopCenter))
                    }
                }
            }
        }
    }

    private companion object {
        const val NO_ORIENTATION = -99
    }
}

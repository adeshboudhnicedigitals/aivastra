package aivastra.nice.interactive

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.core.view.WindowCompat
import androidx.navigation.compose.rememberNavController
import aivastra.nice.interactive.data.repository.AppVideoRepository
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.navigation.AppNavGraph
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.update.InAppUpdateChecker

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
                    val navController = rememberNavController()

                    AppNavGraph(
                        navController = navController,
                        modifier = Modifier.fillMaxSize()
                    )

                    InAppUpdateChecker()
                }
            }
        }
    }

    override fun onDestroy() {
        // Force the loading video to re-download on the next app open (rather than relying on
        // whatever's left in cacheDir) so a backend video change shows up without a reinstall.
        AppVideoRepository.clearCache(applicationContext)
        super.onDestroy()
    }
}

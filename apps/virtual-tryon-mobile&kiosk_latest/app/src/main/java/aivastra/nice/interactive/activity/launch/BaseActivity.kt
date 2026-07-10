package aivastra.nice.interactive.activity.launch

import aivastra.nice.interactive.R
import aivastra.nice.interactive.network.InternetSpeedChecker
import aivastra.nice.interactive.network.NetworkDialogManager
import aivastra.nice.interactive.network.NetworkMonitor
import aivastra.nice.interactive.network.NetworkState
import aivastra.nice.interactive.network.NetworkUtils
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.ImageView
import android.widget.PopupMenu
import android.widget.RelativeLayout
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

open class BaseActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Enables edge-to-edge drawing for Android 10+
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        makeBarsTransparentAndVisible()
//        apiErrorHandleDialog()
    }

    override fun setContentView(layoutResID: Int) {
        super.setContentView(layoutResID)

        // Apply padding for status and navigation bars to the root view
        val rootView = findViewById<View>(android.R.id.content).rootView
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }
    }

    @Suppress("DEPRECATION")
    private fun makeBarsTransparentAndVisible() {
        val window = window

        // ✅ Make status & nav bars transparent
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // ✅ Android 11+
            val controller = window.insetsController
            controller?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            // ✅ Android 10 and below
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    private fun apiErrorHandleDialog(){
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                NetworkMonitor.observe().collect {
                    Log.e("NetworkState Observer received","$it")
                    when (it) {
                        NetworkState.NO_INTERNET -> {
                            NetworkDialogManager.showNoInternetDialog(this@BaseActivity)
                        }

                        NetworkState.SLOW -> {
                            NetworkDialogManager.showSlowInternetDialog(this@BaseActivity)
                        }

                        NetworkState.TIMEOUT -> {
                            NetworkDialogManager.showTimeoutDialog(this@BaseActivity)
                        }

                        NetworkState.SERVER_ERROR -> {
                            NetworkDialogManager.showServerErrorDialog(this@BaseActivity)
                        }

                        else -> {}
                    }
                }
            }
        }
    }
}
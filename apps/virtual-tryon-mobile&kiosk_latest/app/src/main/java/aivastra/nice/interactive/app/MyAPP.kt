package aivastra.nice.interactive.app

import aivastra.nice.interactive.network.InternetSpeedChecker
import aivastra.nice.interactive.network.NetworkDialogManager
import aivastra.nice.interactive.network.NetworkMonitor
import aivastra.nice.interactive.network.NetworkState
import aivastra.nice.interactive.network.NetworkUtils
import aivastra.nice.interactive.utils.ViewControll
import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.lifecycleScope
import coil.ImageLoader
import com.example.facewixlatest.ApiUtils.APICaller
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MyAPP : Application(), DefaultLifecycleObserver  {


    override fun onCreate() {
        super<Application>.onCreate()
        appContext = applicationContext
        // FIX: Move disk I/O (cache delete) off the main thread
        CoroutineScope(Dispatchers.IO).launch {
            ViewControll.clearAppCache(applicationContext)
        }
        NetworkMonitor.start(applicationContext)
        APICaller.init(applicationContext)
    }

    public override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
    }

    companion object {
        var appContext: Context? = null
    }
}

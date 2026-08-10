package aivastra.nice.interactive

import android.app.Application
import aivastra.nice.interactive.utils.CrashReporter
import aivastra.nice.interactive.utils.NetworkMonitor

class AiVastraApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashReporter.init()
        NetworkMonitor.initialize(this)
    }
}

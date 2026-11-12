package aivastra.nice.interactive.utils

import android.util.Log

/**
 * Test-copy stand-in for the Crashlytics-backed CrashReporter in
 * virtual_tryon_android_multi_flow. Same API, so no call site changes; logs locally only,
 * because this build has no Firebase project and must not report into production's.
 */
object CrashReporter {
    private const val TAG = "CrashReporter"

    fun init() = Unit

    fun setUserId(userId: String?) = Unit

    fun log(message: String) {
        Log.d(TAG, message)
    }

    fun setCustomKey(key: String, value: String) = Unit

    fun recordException(throwable: Throwable, tag: String = TAG) {
        Log.e(tag, throwable.message, throwable)
    }
}

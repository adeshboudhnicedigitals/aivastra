package aivastra.nice.interactive

import android.app.Application
import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class AiVastraApplication : Application() {

    companion object {
        lateinit var instance: AiVastraApplication
            private set

        const val VIDEO_URL = "https://api.aivastra.com/aivastravideo.mp4"
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        preloadVideoCache()
    }

    private fun preloadVideoCache() {
        val cacheFile = File(cacheDir, "aivastravideo.mp4")
        val tempFile = File(cacheDir, "aivastravideo.mp4.tmp")

        // If valid cached file (> 100 KB) exists, no need to redownload
        if (cacheFile.exists() && cacheFile.length() > 100_000) {
            Log.d("AiVastraApp", "Video already cached locally: ${cacheFile.absolutePath} (${cacheFile.length()} bytes)")
            return
        }

        // Clean up partial or broken files
        if (cacheFile.exists()) {
            cacheFile.delete()
        }
        if (tempFile.exists()) {
            tempFile.delete()
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                Log.d("AiVastraApp", "Preloading video from: $VIDEO_URL")
                val client = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(30, TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .build()

                val request = Request.Builder().url(VIDEO_URL).build()
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        response.body?.byteStream()?.use { input ->
                            FileOutputStream(tempFile).use { output ->
                                input.copyTo(output)
                            }
                        }
                        if (tempFile.length() > 100_000) {
                            tempFile.renameTo(cacheFile)
                            Log.d("AiVastraApp", "Video cached successfully (${cacheFile.length()} bytes)")
                        } else {
                            Log.w("AiVastraApp", "Downloaded video too small (${tempFile.length()} bytes), deleting temp file")
                            tempFile.delete()
                        }
                    } else {
                        Log.e("AiVastraApp", "Video download HTTP error code: ${response.code}")
                    }
                }
            } catch (e: Exception) {
                Log.e("AiVastraApp", "Failed to preload video", e)
                if (tempFile.exists()) tempFile.delete()
            }
        }
    }

    fun getCachedVideoUri(context: Context? = null): Uri {
        val cacheFile = File(cacheDir, "aivastravideo.mp4")
        if (cacheFile.exists() && cacheFile.length() > 100_000) {
            return Uri.fromFile(cacheFile)
        }
        val ctx = context ?: this
        return Uri.parse("android.resource://${ctx.packageName}/${R.raw.loading_video}")
    }
}

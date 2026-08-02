package aivastra.nice.interactive.data.repository

import android.content.Context
import android.net.Uri
import android.util.Log
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.api.ApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class AppVideoRepository(
    private val apiService: ApiService = ApiClient.apiService,
    private val storageClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
) {
    // Fixed filename (not timestamped) — each session's fetch overwrites the previous one,
    // so nothing accumulates in cacheDir and nothing survives past this process's lifetime
    // other than as leftover bytes that the next session immediately overwrites.
    private val cacheFileName = "session_app_video.mp4"

    suspend fun fetchAppVideoUri(context: Context): Uri? = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getAppVideoConfig()
            val videoUrl = response.body()?.videoUrl
            if (!response.isSuccessful || videoUrl.isNullOrBlank()) return@withContext null

            val cacheFile = File(context.cacheDir, cacheFileName)
            val tempFile = File(context.cacheDir, "$cacheFileName.tmp")
            val request = Request.Builder().url(videoUrl).build()
            storageClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.e("AppVideoRepository", "Video download HTTP error: ${response.code}")
                    return@withContext null
                }
                response.body?.byteStream()?.use { input ->
                    FileOutputStream(tempFile).use { output -> input.copyTo(output) }
                } ?: return@withContext null
            }
            tempFile.renameTo(cacheFile)
            Uri.fromFile(cacheFile)
        } catch (e: Exception) {
            Log.e("AppVideoRepository", "Failed to fetch/cache app video", e)
            null
        }
    }
}

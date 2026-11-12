package aivastra.nice.interactive.data.repository

import android.content.Context
import android.net.Uri
import android.util.Log
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.api.ApiService
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.utils.CrashReporter
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
    private data class CachedVideoMeta(val url: String, val etag: String?)

    companion object {
        // Fixed filename (not timestamped) — each successful fetch overwrites the previous one.
        private const val CACHE_FILE_NAME = "session_app_video.mp4"
        private const val META_FILE_NAME = "$CACHE_FILE_NAME.meta"
    }

    // Revalidates against the backend with a conditional GET (ETag) rather than blindly
    // redownloading, and always falls back to whatever is already cached on any failure — a
    // transient network hiccup right at cold start must never leave the kiosk with no loading
    // video for the rest of that app session, which is what happened when the previous
    // implementation deleted the cached file up front and had a single, non-recoverable attempt.
    suspend fun fetchAppVideoUri(context: Context): Uri? = withContext(Dispatchers.IO) {
        val cacheFile = File(context.cacheDir, CACHE_FILE_NAME)
        val metaFile = File(context.cacheDir, META_FILE_NAME)
        val existingUri = cacheFile.takeIf { it.exists() }?.let { Uri.fromFile(it) }

        val videoUrl = try {
            resolveVideoUrl()
        } catch (e: Exception) {
            Log.e("AppVideoRepository", "Failed to resolve app video URL", e)
            CrashReporter.recordException(e, "AppVideoRepository")
            null
        }

        if (videoUrl.isNullOrBlank()) {
            // No video configured right now, or the config call itself failed — still show
            // whatever was cached from a previous successful fetch rather than nothing.
            return@withContext existingUri
        }

        val cachedMeta = readMeta(metaFile)
        val etagForRequest = cachedMeta?.takeIf { it.url == videoUrl }?.etag
        val tempFile = File(context.cacheDir, "$CACHE_FILE_NAME.tmp")

        try {
            val requestBuilder = Request.Builder().url(videoUrl)
            if (!etagForRequest.isNullOrBlank()) {
                requestBuilder.header("If-None-Match", etagForRequest)
            }

            storageClient.newCall(requestBuilder.build()).execute().use { response ->
                when {
                    response.code == 304 -> existingUri
                    !response.isSuccessful -> {
                        Log.e("AppVideoRepository", "Video download HTTP error: ${response.code}")
                        existingUri
                    }
                    else -> {
                        val body = response.body
                        if (body == null) {
                            existingUri
                        } else {
                            body.byteStream().use { input ->
                                FileOutputStream(tempFile).use { output -> input.copyTo(output) }
                            }
                            if (tempFile.renameTo(cacheFile)) {
                                writeMeta(metaFile, videoUrl, response.header("ETag"))
                                Uri.fromFile(cacheFile)
                            } else {
                                existingUri
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("AppVideoRepository", "Failed to fetch/cache app video", e)
            CrashReporter.recordException(e, "AppVideoRepository")
            existingUri
        } finally {
            tempFile.delete()
        }
    }

    private suspend fun resolveVideoUrl(): String? {
        // A merchant's uploaded override (persisted at login, see LoginViewModel /
        // SessionManager) always wins; only fall back to the global config-driven
        // clip when the signed-in merchant has none set.
        val sessionVideoUrl = SessionManager.loadingVideoUrl
        if (!sessionVideoUrl.isNullOrBlank()) return sessionVideoUrl
        val response = apiService.getAppVideoConfig()
        if (!response.isSuccessful) return null
        return response.body()?.videoUrl
    }

    private fun readMeta(metaFile: File): CachedVideoMeta? {
        if (!metaFile.exists()) return null
        return try {
            val lines = metaFile.readText().lines()
            val url = lines.getOrNull(0)?.takeIf { it.isNotBlank() } ?: return null
            val etag = lines.getOrNull(1)?.takeIf { it.isNotBlank() }
            CachedVideoMeta(url, etag)
        } catch (e: Exception) {
            null
        }
    }

    private fun writeMeta(metaFile: File, url: String, etag: String?) {
        if (etag.isNullOrBlank()) {
            // Nothing to key a future conditional request off — drop any stale meta so we
            // don't send a mismatched If-None-Match next time.
            metaFile.delete()
            return
        }
        try {
            metaFile.writeText("$url\n$etag")
        } catch (e: Exception) {
            metaFile.delete()
        }
    }
}

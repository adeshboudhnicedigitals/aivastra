package com.example.facewixlatest.ApiUtils

import aivastra.nice.aivastraadmin.BuildConfig
import aivastra.nice.aivastraadmin.utils.PrefsManager
import android.annotation.SuppressLint
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

@SuppressLint("StaticFieldLeak")
object APICaller {
    private lateinit var context: Context
    private val jsonMediaType = "application/json".toMediaType()

    fun init(appContext: Context) {
        context = appContext.applicationContext
    }

    private val client: OkHttpClient by lazy {
        // BODY logs full request/response bodies and the Authorization header to logcat.
        // Only acceptable on debug builds. Release must never log tokens or payloads.
        val logging = HttpLoggingInterceptor().setLevel(
            if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE,
        )
        OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(120, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }

    // Content-Type comes from the RequestBody and is omitted for empty bodies. Fastify rejects
    // zero-length request bodies declared as application/json, including GET, DELETE, and empty PUT.
    private fun jsonBody(body: String) = body.toRequestBody(if (body.isNotEmpty()) jsonMediaType else null)

    suspend fun postJson(url: String, body: String): String {
        val request = Request.Builder()
            .url(resolveUrl(url))
            .post(jsonBody(body))
            .build()
        return execute(request)
    }

    suspend fun getJson(url: String): String {
        val request = Request.Builder().url(resolveUrl(url)).get().build()
        return execute(request)
    }

    suspend fun putJson(url: String, body: String = ""): String {
        val request = Request.Builder()
            .url(resolveUrl(url))
            .put(jsonBody(body))
            .build()
        return execute(request)
    }

    /** Raw PUT of arbitrary bytes to a presigned R2 URL: no Authorization or base-URL resolution. */
    suspend fun putToPresignedUrl(uploadUrl: String, body: RequestBody) {
        val request = Request.Builder().url(uploadUrl).put(body).build()
        withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException.ClientError("Upload failed: HTTP ${response.code}")
                }
            }
        }
    }

    suspend fun postJsonAuthed(url: String, body: String, accessToken: String): String =
        executeAuthed(Request.Builder().post(jsonBody(body)), url, accessToken)

    suspend fun getJsonAuthed(url: String, accessToken: String): String =
        executeAuthed(Request.Builder().get(), url, accessToken)

    suspend fun patchJsonAuthed(url: String, body: String, accessToken: String): String =
        executeAuthed(Request.Builder().patch(jsonBody(body)), url, accessToken)

    private val refreshMutex = Mutex()

    private suspend fun executeAuthed(
        builder: Request.Builder,
        url: String,
        accessToken: String,
    ): String {
        val resolvedUrl = resolveUrl(url)
        val request = builder
            .url(resolvedUrl)
            .header(APIConstant.Parameter.AUTHORIZATION, "Bearer $accessToken")
            .build()
        return try {
            execute(request)
        } catch (e: ApiException.BackendError) {
            if (e.httpStatus == 401 && refreshAccessToken()) {
                val retryRequest = builder
                    .url(resolvedUrl)
                    .header(APIConstant.Parameter.AUTHORIZATION, "Bearer ${PrefsManager.getAccessToken()}")
                    .build()
                execute(retryRequest)
            } else {
                throw e
            }
        }
    }

    private suspend fun refreshAccessToken(): Boolean = refreshMutex.withLock {
        val refreshToken = PrefsManager.getRefreshToken()
        if (refreshToken.isBlank()) return@withLock false
        try {
            val body = JSONObject().apply {
                put("refreshToken", refreshToken)
                put("platform", "mobile")
            }.toString()
            val request = Request.Builder()
                .url(resolveUrl(APIConstant.API_ENDPOINTS.DEVICE_REFRESH))
                .post(jsonBody(body))
                .build()
            val json = JSONObject(execute(request))
            val newAccessToken = json.optString("accessToken", "")
            if (newAccessToken.isBlank()) return@withLock false
            PrefsManager.updateAccessToken(newAccessToken)
            val newRefreshToken = json.optString("refreshToken", "")
            if (newRefreshToken.isNotBlank()) {
                PrefsManager.saveRefreshToken(newRefreshToken)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                val bodyString = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw parseBackendError(bodyString, response.code)
                }
                bodyString
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: SocketTimeoutException) {
            throw ApiException.NetworkError(e)
        } catch (e: IOException) {
            throw ApiException.NetworkError(e)
        }
    }

    private fun parseBackendError(body: String, httpStatus: Int): ApiException.BackendError {
        return try {
            val error = JSONObject(body).getJSONObject("error")
            ApiException.BackendError(
                code = error.optString("code", "UNKNOWN"),
                backendMessage = error.optString("message", "HTTP $httpStatus"),
                httpStatus = httpStatus,
                rawBody = body,
            )
        } catch (_: Exception) {
            ApiException.BackendError(
                code = "HTTP_$httpStatus",
                backendMessage = body.ifBlank { "HTTP $httpStatus" },
                httpStatus = httpStatus,
                rawBody = body,
            )
        }
    }

    private fun resolveUrl(url: String): String {
        return if (url.startsWith("http://") || url.startsWith("https://")) url else baseURL() + url
    }

    fun baseURL(): String = APIConstant.BASE_URL
}
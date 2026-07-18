package com.example.facewixlatest.ApiUtils

import aivastra.nice.interactive.BuildConfig
import aivastra.nice.interactive.network.NetworkInterceptor
import aivastra.nice.interactive.utils.PrefsManager
import android.annotation.SuppressLint
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/** Every network call exposes whether failure came from the server, network, or client. */
sealed class ApiException(message: String) : Exception(message) {
    class BackendError(val code: String, val backendMessage: String, val httpStatus: Int, val rawBody: String = "") :
        ApiException(backendMessage)

    class NetworkError(cause: Throwable) : ApiException(cause.message ?: "Network error")

    class ClientError(message: String) : ApiException(message)
}

@SuppressLint("StaticFieldLeak")
object APICaller {
    private lateinit var context: Context
    private val jsonMediaType = "application/json".toMediaType()

    fun init(appContext: Context) {
        context = appContext.applicationContext
    }

    private val client: OkHttpClient by lazy {
        // BODY logs full request/response bodies AND the Authorization header to logcat —
        // only acceptable on debug builds. Release must never log tokens or payloads.
        val logging = HttpLoggingInterceptor().setLevel(
            if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE,
        )
        OkHttpClient.Builder()
            .addInterceptor(NetworkInterceptor(context))
            .addInterceptor(logging)
            .connectTimeout(120, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }

    // Content-Type is derived solely from the RequestBody's own media type below (null when
    // there's no real JSON payload) rather than a manual header — Fastify's default JSON
    // content-type parser rejects ANY request that declares Content-Type: application/json but
    // sends a zero-length body (FST_ERR_CTP_EMPTY_JSON_BODY, 400), which every GET/DELETE and
    // every empty-bodied PUT was triggering before this fix, since a manual header was being
    // attached unconditionally regardless of whether a body existed.
    private fun jsonBody(body: String) = body.toRequestBody(if (body.isNotEmpty()) jsonMediaType else null)

    suspend fun postJson(url: String, body: String): String {
        val request = Request.Builder()
            .url(resolveUrl(url))
            .post(jsonBody(body))
            .build()
        return execute(request)
    }

    suspend fun deleteJson(url: String, body: String? = null): String {
        val request = Request.Builder()
            .url(resolveUrl(url))
            .delete(body?.let { jsonBody(it) })
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

    suspend fun postJsonAuthed(url: String, body: String, accessToken: String): String =
        executeAuthed(Request.Builder().post(jsonBody(body)), url, accessToken)

    suspend fun getJsonAuthed(url: String, accessToken: String): String =
        executeAuthed(Request.Builder().get(), url, accessToken)

    suspend fun putJsonAuthed(url: String, accessToken: String, body: String = ""): String =
        executeAuthed(Request.Builder().put(jsonBody(body)), url, accessToken)

    suspend fun deleteAuthed(url: String, accessToken: String): String =
        executeAuthed(Request.Builder().delete(), url, accessToken)

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
            // The access token is short-lived (15 min); refresh once and retry the same request
            // rather than surfacing a 401 to the user for what's really a routine token expiry.
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
            // Must match the platform value device-login sent (SareeCategoryDataRepository sends
            // "kiosk") — rotateTokenFamily rejects the refresh with INVALID_REFRESH on mismatch.
            val body = JSONObject().apply {
                put("refreshToken", refreshToken)
                put("platform", "kiosk")
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

    interface APICallBack {
        fun <T> onSuccess(modelclass: T): Class<T>?
        fun onFailure()
    }

    interface APICallBackWithError {
        fun <T> onSuccess(modelclass: T): Class<T>?
        fun onFailure(errorMsg: String)
    }
}
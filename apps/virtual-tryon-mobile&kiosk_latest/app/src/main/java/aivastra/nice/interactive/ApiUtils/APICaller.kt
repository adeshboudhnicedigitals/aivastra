package com.example.facewixlatest.ApiUtils

import aivastra.nice.interactive.network.NetworkInterceptor
import android.annotation.SuppressLint
import android.content.Context
import kotlinx.coroutines.Dispatchers
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
        val logging = HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BODY)
        OkHttpClient.Builder()
            .addInterceptor(NetworkInterceptor(context))
            .addInterceptor(logging)
            .connectTimeout(120, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }

    suspend fun postJson(url: String, body: String): String {
        val request = Request.Builder()
            .url(resolveUrl(url))
            .post(body.toRequestBody(jsonMediaType))
            .header(APIConstant.Parameter.CONTENT_TYPE, "application/json")
            .build()
        return execute(request)
    }

    suspend fun deleteJson(url: String, body: String? = null): String {
        val requestBody = (body ?: "").toRequestBody(jsonMediaType)
        val request = Request.Builder()
            .url(resolveUrl(url))
            .delete(if (body != null) requestBody else null)
            .header(APIConstant.Parameter.CONTENT_TYPE, "application/json")
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
            .put(body.toRequestBody(jsonMediaType))
            .header(APIConstant.Parameter.CONTENT_TYPE, "application/json")
            .build()
        return execute(request)
    }

    suspend fun postJsonAuthed(url: String, body: String, accessToken: String): String =
        executeAuthed(Request.Builder().post(body.toRequestBody(jsonMediaType)), url, accessToken)

    suspend fun getJsonAuthed(url: String, accessToken: String): String =
        executeAuthed(Request.Builder().get(), url, accessToken)

    suspend fun putJsonAuthed(url: String, accessToken: String, body: String = ""): String =
        executeAuthed(Request.Builder().put(body.toRequestBody(jsonMediaType)), url, accessToken)

    suspend fun deleteAuthed(url: String, accessToken: String): String =
        executeAuthed(Request.Builder().delete(), url, accessToken)

    private suspend fun executeAuthed(
        builder: Request.Builder,
        url: String,
        accessToken: String,
    ): String {
        val request = builder
            .url(resolveUrl(url))
            .header(APIConstant.Parameter.AUTHORIZATION, "Bearer $accessToken")
            .header(APIConstant.Parameter.CONTENT_TYPE, "application/json")
            .build()
        return execute(request)
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
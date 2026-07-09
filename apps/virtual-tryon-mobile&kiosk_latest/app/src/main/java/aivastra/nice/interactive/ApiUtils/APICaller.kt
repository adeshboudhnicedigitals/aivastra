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
import java.util.concurrent.TimeUnit

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

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException(body.ifBlank { "HTTP ${response.code}" })
            }
            body
        }
    }

    private fun resolveUrl(url: String): String {
        return if (url.startsWith("http://") || url.startsWith("https://")) url else baseURL() + url
    }

    fun baseURL(): String = APIConstant.BASE_URL

    fun <T> getRequest(
        url: String?,
        headers: HashMap<String, String>,
        modelclass: Class<T>?,
        apiCallBack: APICallBack,
    ): Class<T>? {
        apiCallBack.onFailure()
        return null
    }

    fun <T> getRequestWithJSONARRAY(
        url: String?,
        params: HashMap<String, String>,
        modelclass: Class<T>?,
        apiCallBack: APICallBack,
    ): Class<T>? {
        apiCallBack.onFailure()
        return null
    }

    fun <T> postRequest(
        url: String?,
        params: HashMap<String?, RequestBody?>,
        headers: HashMap<String?, String?>,
        modelclass: Class<T>?,
        apiCallBack: APICallBackWithError,
    ): Class<T>? {
        apiCallBack.onFailure(APIConstant.errorSomethingWrong)
        return null
    }

    fun <T> postRequestTryOnAPI(
        url: String?,
        params: HashMap<String?, RequestBody?>,
        headers: HashMap<String?, String?>,
        modelclass: Class<T>?,
        apiCallBack: APICallBackWithError,
    ): Class<T>? {
        apiCallBack.onFailure(APIConstant.errorSomethingWrong)
        return null
    }

    fun <T> postMultipartRequest(
        url: String?,
        headers: HashMap<String, String>?,
        params: HashMap<String, RequestBody>?,
        image: MultipartBody.Part?,
        modelclass: Class<T>?,
        apiCallBack: APICallBack,
    ): Class<T>? {
        apiCallBack.onFailure()
        return null
    }

    fun <T> postMultipleMultipartRequest(
        url: String?,
        headers: HashMap<String, String>?,
        params: HashMap<String, RequestBody>?,
        images: MutableList<MultipartBody.Part>,
        modelclass: Class<T>?,
        apiCallBack: APICallBack,
    ): Class<T>? {
        apiCallBack.onFailure()
        return null
    }

    interface APICallBack {
        fun <T> onSuccess(modelclass: T): Class<T>?
        fun onFailure()
    }

    interface APICallBackWithError {
        fun <T> onSuccess(modelclass: T): Class<T>?
        fun onFailure(errorMsg: String)
    }
}
package aivastra.nice.interactive.api

import aivastra.nice.interactive.BuildConfig
import aivastra.nice.interactive.device.DeviceApi
import aivastra.nice.interactive.device.DeviceStore
import aivastra.nice.interactive.device.StaffSession
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Retrofit setup for the merchant test app, which runs in device mode only (device-mode plan,
 * M1): every request carries `Authorization: Device <token>` from pairing. There is no owner
 * login and no refresh-token cycle; a device token does not expire, it is revoked.
 */
object ApiClient {
    // Set per build in app/build.gradle.kts (local API by default; production is refused).
    private val BASE_URL = BuildConfig.API_BASE_URL

    /** Kept so the inherited owner-app code still compiles; device mode never sends a bearer. */
    @Suppress("UNUSED_PARAMETER")
    fun setAccessToken(token: String?) = Unit

    // Full BODY logging only in debug: bodies carry tokens and shopper photos' keys.
    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
        redactHeader("Authorization")
        redactHeader(STAFF_HEADER)
    }

    private const val STAFF_HEADER = "x-staff-authorization"

    private val deviceAuth = Interceptor { chain ->
        val original = chain.request()
        val builder = original.newBuilder()
        DeviceStore.token?.takeIf { it.isNotBlank() }?.let { builder.header("Authorization", "Device $it") }
        // The server reads the staff header only to start an assisted session and for the
        // seller's undo, so it is sent on those routes alone, not on every request.
        val path = original.url.encodedPath
        val staffRoute = (original.method == "POST" && path.endsWith("/v1/device/sessions")) ||
            (original.method == "DELETE" && path.contains("/v1/device/sessions/"))
        if (staffRoute) StaffSession.validToken()?.let { builder.header(STAFF_HEADER, "Bearer $it") }
        val response = chain.proceed(builder.build())
        // Deactivated device, branch or merchant: the token is dead for good. Unpair, so the
        // UI goes back to the pairing screen instead of failing every call.
        if (response.code == 401 && DeviceStore.token != null &&
            response.peekBody(4096).string().contains("\"DEVICE_INACTIVE\"")
        ) {
            DeviceStore.clear()
        }
        response
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(deviceAuth)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val apiService: ApiService = retrofit.create(ApiService::class.java)
    val deviceApi: DeviceApi = retrofit.create(DeviceApi::class.java)

    /** Same service; the owner app's separate unauthenticated client is not needed any more. */
    val authApiService: ApiService get() = apiService
}

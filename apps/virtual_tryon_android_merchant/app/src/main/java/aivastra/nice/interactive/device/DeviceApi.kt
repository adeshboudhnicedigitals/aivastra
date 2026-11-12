package aivastra.nice.interactive.device

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

// The v1.0 device endpoints that have no owner-app twin (device-mode plan). Catalog, photo and
// try-on reads stay in ApiService, pointed at their /v1/device/* twins.

data class PairRequest(@SerializedName("code") val code: String)

data class PairResponse(
    @SerializedName("token") val token: String,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("branchId") val branchId: String,
    @SerializedName("name") val name: String,
)

data class DeviceMeResponse(
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("branchId") val branchId: String,
    @SerializedName("name") val name: String?,
)

data class StartSessionRequest(@SerializedName("mode") val mode: String)

data class SessionResponse(
    @SerializedName("id") val id: String,
    @SerializedName("mode") val mode: String,
    @SerializedName("staffId") val staffId: String?,
    @SerializedName("endedAt") val endedAt: String?,
)

data class SessionItemRequest(
    @SerializedName("catalogItemId") val catalogItemId: String,
    @SerializedName("action") val action: String,
)

data class SessionItemResponse(
    @SerializedName("id") val id: String,
    @SerializedName("action") val action: String,
)

data class EventsBatchRequest(@SerializedName("events") val events: List<QueuedEvent>)

data class StaffLoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
)

data class StaffLoginResponse(@SerializedName("accessToken") val accessToken: String?)

interface DeviceApi {
    /** Unauthenticated: the pairing code is the only credential. */
    @POST("v1/device/pair")
    suspend fun pair(@Body body: PairRequest): Response<PairResponse>

    @GET("v1/device/me")
    suspend fun me(): Response<DeviceMeResponse>

    /** `Idempotency-Key` makes a retried start return the same session, not a second one. */
    @POST("v1/device/sessions")
    suspend fun startSession(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: StartSessionRequest,
    ): Response<SessionResponse>

    @POST("v1/device/sessions/{id}/end")
    suspend fun endSession(@Path("id") sessionId: String): Response<SessionResponse>

    @POST("v1/device/sessions/{id}/items")
    suspend fun addItem(@Path("id") sessionId: String, @Body body: SessionItemRequest): Response<SessionItemResponse>

    /** The seller's undo; needs the seller's own staff token (x-staff-authorization). */
    @DELETE("v1/device/sessions/{id}/items/{itemId}")
    suspend fun undoItem(@Path("id") sessionId: String, @Path("itemId") itemId: String): Response<Unit>

    @POST("v1/device/events")
    suspend fun uploadEvents(@Body body: EventsBatchRequest): Response<Unit>

    /** Merchant-web's login, used for a staff member signing in on the tablet (plan M3). */
    @POST("v1/auth/login")
    suspend fun staffLogin(@Body body: StaffLoginRequest): Response<StaffLoginResponse>
}

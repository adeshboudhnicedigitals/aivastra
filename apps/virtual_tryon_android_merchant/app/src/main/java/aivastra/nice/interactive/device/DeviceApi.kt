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

data class IdentifyStartResponse(
    @SerializedName("code") val code: String,
    @SerializedName("waLink") val waLink: String,
    @SerializedName("expiresAt") val expiresAt: String,
)

data class IdentifyStatusResponse(@SerializedName("status") val status: String)

// CRM phase 3: sizes with this branch's availability, and the cart (spec §6.1–6.2).
data class OtherBranch(
    @SerializedName("branchId") val branchId: String,
    @SerializedName("name") val name: String,
    @SerializedName("status") val status: String,
)

data class DeviceVariant(
    @SerializedName("id") val id: String,
    @SerializedName("size") val size: String,
    @SerializedName("colour") val colour: String,
    @SerializedName("barcode") val barcode: String?,
    @SerializedName("sku") val sku: String?,
    @SerializedName("pricePaise") val pricePaise: Int,
    /** in_stock | low | out | unknown */
    @SerializedName("status") val status: String,
    @SerializedName("otherBranches") val otherBranches: List<OtherBranch>,
)

data class DeviceVariantsResponse(
    @SerializedName("variants") val variants: List<DeviceVariant>,
    @SerializedName("buyOnlineUrl") val buyOnlineUrl: String?,
)

data class CartLineAddRequest(
    @SerializedName("variantId") val variantId: String,
    @SerializedName("quantity") val quantity: Int = 1,
)

data class CartLine(
    @SerializedName("id") val id: String,
    @SerializedName("label") val label: String,
    @SerializedName("size") val size: String,
    @SerializedName("colour") val colour: String,
    @SerializedName("sku") val sku: String?,
    @SerializedName("barcode") val barcode: String?,
    @SerializedName("quantity") val quantity: Int,
    @SerializedName("unitPricePaise") val unitPricePaise: Int,
    @SerializedName("billed") val billed: Boolean,
)

data class CartView(
    @SerializedName("cartCode") val cartCode: String,
    @SerializedName("status") val status: String,
    @SerializedName("lines") val lines: List<CartLine>,
    @SerializedName("totalPaise") val totalPaise: Int,
)

data class CartEnvelope(@SerializedName("cart") val cart: CartView?)

class EmptyBody

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

    /** CRM phase 2: a code + wa.me link to the brand's number; 409 = WhatsApp not set up (QR only). */
    @POST("v1/device/sessions/{id}/identify")
    suspend fun identifyStart(@Path("id") sessionId: String): Response<IdentifyStartResponse>

    @GET("v1/device/sessions/{id}/identify")
    suspend fun identifyStatus(@Path("id") sessionId: String): Response<IdentifyStatusResponse>

    @GET("v1/device/catalog/{itemId}/variants")
    suspend fun variants(@Path("itemId") itemId: String): Response<DeviceVariantsResponse>

    @GET("v1/device/sessions/{id}/cart")
    suspend fun cart(@Path("id") sessionId: String): Response<CartEnvelope>

    @POST("v1/device/sessions/{id}/cart/lines")
    suspend fun addToCart(
        @Path("id") sessionId: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: CartLineAddRequest,
    ): Response<CartView>

    @DELETE("v1/device/sessions/{id}/cart/lines/{lineId}")
    suspend fun removeFromCart(@Path("id") sessionId: String, @Path("lineId") lineId: String): Response<CartView>

    /** Assisted only: billed with the signed-in staff member's token (x-staff-authorization). */
    @POST("v1/device/sessions/{id}/cart/bill")
    suspend fun billCart(@Path("id") sessionId: String, @Body body: EmptyBody = EmptyBody()): Response<CartView>

    /** Merchant-web's login, used for a staff member signing in on the tablet (plan M3). */
    @POST("v1/auth/login")
    suspend fun staffLogin(@Body body: StaffLoginRequest): Response<StaffLoginResponse>
}

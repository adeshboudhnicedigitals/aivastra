package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName

data class TryOnJobRequest(
    /** The in-store session this try-on belongs to (POST /v1/device/tryon/jobs). */
    @SerializedName("sessionId") val sessionId: String,
    @SerializedName("merchantCatalogItemId") val merchantCatalogItemId: String,
    @SerializedName("customerPhotoKey") val customerPhotoKey: String
)

/** Quick try-on: the camera photo alone, the admin-chosen workflow supplies the look. */
data class QuickTryOnJobRequest(
    @SerializedName("customerPhotoKey") val customerPhotoKey: String
)

data class TryOnJobResponse(
    @SerializedName("jobId") val jobId: String
)

data class TryOnStatusResponse(
    @SerializedName("id") val id: String? = null,
    @SerializedName("status") val status: String,
    @SerializedName("merchantId") val merchantId: String? = null,
    @SerializedName("resultKey") val resultKey: String? = null,
    @SerializedName("shareUrl") val shareUrl: String? = null,
    @SerializedName("errorCode") val errorCode: String? = null,
    @SerializedName("liked") val liked: Boolean? = false,
    @SerializedName("inCart") val inCart: Boolean? = false,
    @SerializedName("createdAt") val createdAt: String? = null,
    @SerializedName("completedAt") val completedAt: String? = null
)

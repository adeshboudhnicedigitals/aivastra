package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName

data class MerchantMeResponse(
    @SerializedName("displayName") val displayName: String,
    @SerializedName("email") val email: String,
    @SerializedName("balance") val balance: Int,
    @SerializedName("used") val used: Int,
    // Absent on older servers, hence nullable.
    @SerializedName("unlimitedPlan") val unlimitedPlan: UnlimitedPlanInfo? = null
)

/** `status` is "active", "expiring_soon", "expired", "revoked", "offered" or "none". */
data class UnlimitedPlanInfo(
    @SerializedName("status") val status: String,
    @SerializedName("endAt") val endAt: String?
)

package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName

// ─── Requests ───────────────────────────────────────────────────────────────

data class DeviceLoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("deviceName") val deviceName: String,
    @SerializedName("platform") val platform: String
)


data class ForceLoginRequest(
    @SerializedName("forceLogoutToken") val forceLogoutToken: String,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("deviceName") val deviceName: String,
    @SerializedName("platform") val platform: String
)

data class RefreshTokenRequest(
    @SerializedName("refreshToken") val refreshToken: String,
    @SerializedName("platform") val platform: String
)

data class LogoutRequest(
    @SerializedName("refreshToken") val refreshToken: String
)

// ─── Responses ──────────────────────────────────────────────────────────────

data class UserDto(
    @SerializedName("id") val id: String,
    @SerializedName("email") val email: String,
    @SerializedName("displayName") val displayName: String,
    @SerializedName("tier") val tier: String,
    @SerializedName("maxActiveDevices") val maxActiveDevices: Int,
    @SerializedName("logoUrl") val logoUrlCamel: String? = null,
    @SerializedName("logo_url") val logoUrlSnake: String? = null
) {
    val effectiveLogoUrl: String? get() = logoUrlCamel ?: logoUrlSnake
}

data class DeviceLoginResponse(
    @SerializedName("accessToken") val accessToken: String,
    @SerializedName("refreshToken") val refreshToken: String? = null,
    @SerializedName("logoUrl") val logoUrlCamel: String? = null,
    @SerializedName("logo_url") val logoUrlSnake: String? = null,
    @SerializedName("user") val user: UserDto
) {
    val effectiveLogoUrl: String? get() = logoUrlCamel ?: logoUrlSnake ?: user.effectiveLogoUrl
}

data class RefreshTokenResponse(
    @SerializedName("accessToken") val accessToken: String,
    @SerializedName("refreshToken") val refreshToken: String? = null,
    @SerializedName("logoUrl") val logoUrlCamel: String? = null,
    @SerializedName("logo_url") val logoUrlSnake: String? = null
) {
    val effectiveLogoUrl: String? get() = logoUrlCamel ?: logoUrlSnake
}

data class LogoutResponse(
    @SerializedName("ok") val ok: Boolean
)

// ─── Device Limit Error Payload ──────────────────────────────────────────────

data class ActiveDevice(
    @SerializedName("id") val id: String,
    @SerializedName("platform") val platform: String,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("deviceName") val deviceName: String,
    @SerializedName("createdAt") val createdAt: String,
    @SerializedName("expiresAt") val expiresAt: String
)

data class DeviceLimitErrorData(
    @SerializedName("code") val code: String,
    @SerializedName("message") val message: String,
    @SerializedName("forceLogoutToken") val forceLogoutToken: String,
    @SerializedName("maxActiveDevices") val maxActiveDevices: Int,
    @SerializedName("activeDevices") val activeDevices: List<ActiveDevice>
)

data class DeviceLimitErrorResponse(
    @SerializedName("error") val error: DeviceLimitErrorData
)

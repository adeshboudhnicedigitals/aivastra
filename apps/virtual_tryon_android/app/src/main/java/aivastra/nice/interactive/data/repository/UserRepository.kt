package aivastra.nice.interactive.data.repository

import com.google.gson.Gson
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.data.models.DeviceLoginRequest
import aivastra.nice.interactive.data.models.DeviceLoginResponse
import aivastra.nice.interactive.data.models.DeviceLimitErrorResponse
import aivastra.nice.interactive.data.models.ForceLoginRequest
import aivastra.nice.interactive.data.models.GoogleLoginRequest
import aivastra.nice.interactive.data.models.LogoutRequest
import aivastra.nice.interactive.data.models.LogoutResponse
import aivastra.nice.interactive.data.models.RefreshTokenRequest
import aivastra.nice.interactive.data.models.RefreshTokenResponse
import aivastra.nice.interactive.data.session.SessionManager

/**
 * Sealed result type for clean error boundary at the repository layer.
 */
sealed class AuthResult<out T> {
    data class Success<T>(val data: T) : AuthResult<T>()
    data class DeviceLimitReached(val error: DeviceLimitErrorResponse) : AuthResult<Nothing>()
    data class Failure(val message: String) : AuthResult<Nothing>()
}

/**
 * Repository that acts as the single source of truth for all auth network calls.
 * Uses ApiClient.authApiService for unauthenticated auth endpoints (login, refresh, logout)
 * to prevent token header conflicts and deadlock.
 */
class UserRepository {

    private val gson = Gson()

    suspend fun loginDevice(request: DeviceLoginRequest): AuthResult<DeviceLoginResponse> {
        return try {
            val response = ApiClient.authApiService.loginDevice(request)
            when {
                response.isSuccessful -> {
                    val body = response.body()
                    if (body != null) AuthResult.Success(body)
                    else AuthResult.Failure("Empty response body")
                }
                response.code() == 409 -> {
                    val errJson = response.errorBody()?.string()
                    val limitError = gson.fromJson(errJson, DeviceLimitErrorResponse::class.java)
                    if (limitError?.error?.code == "DEVICE_LIMIT_REACHED") {
                        AuthResult.DeviceLimitReached(limitError)
                    } else {
                        AuthResult.Failure("Login conflict: ${limitError?.error?.message ?: "Unknown"}")
                    }
                }
                else -> {
                    val errBody = response.errorBody()?.string()
                    AuthResult.Failure(errBody ?: "Login failed (${response.code()})")
                }
            }
        } catch (e: Exception) {
            AuthResult.Failure(e.message ?: "Network error. Check your connection.")
        }
    }

    suspend fun loginGoogle(request: GoogleLoginRequest): AuthResult<DeviceLoginResponse> {
        return try {
            val response = ApiClient.authApiService.loginGoogle(request)
            when {
                response.isSuccessful -> {
                    val body = response.body()
                    if (body != null) AuthResult.Success(body)
                    else AuthResult.Failure("Empty response body")
                }
                response.code() == 409 -> {
                    val errJson = response.errorBody()?.string()
                    val limitError = gson.fromJson(errJson, DeviceLimitErrorResponse::class.java)
                    if (limitError?.error?.code == "DEVICE_LIMIT_REACHED") {
                        AuthResult.DeviceLimitReached(limitError)
                    } else {
                        AuthResult.Failure("Login conflict: ${limitError?.error?.message ?: "Unknown"}")
                    }
                }
                else -> {
                    val errBody = response.errorBody()?.string()
                    AuthResult.Failure(errBody ?: "Google login failed (${response.code()})")
                }
            }
        } catch (e: Exception) {
            AuthResult.Failure(e.message ?: "Network error. Check your connection.")
        }
    }

    suspend fun forceLogin(request: ForceLoginRequest): AuthResult<DeviceLoginResponse> {
        return try {
            val response = ApiClient.authApiService.forceLogin(request)
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) AuthResult.Success(body)
                else AuthResult.Failure("Empty response body")
            } else {
                val errBody = response.errorBody()?.string()
                AuthResult.Failure(errBody ?: "Force login failed (${response.code()})")
            }
        } catch (e: Exception) {
            AuthResult.Failure(e.message ?: "Network error. Check your connection.")
        }
    }

    suspend fun refreshToken(refreshToken: String, platform: String = "kiosk"): AuthResult<RefreshTokenResponse> {
        return try {
            val response = ApiClient.authApiService.refreshToken(RefreshTokenRequest(refreshToken, platform))
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) AuthResult.Success(body)
                else AuthResult.Failure("Empty response body")
            } else {
                val errBody = response.errorBody()?.string()
                AuthResult.Failure(errBody ?: "Token refresh failed (${response.code()})")
            }
        } catch (e: Exception) {
            AuthResult.Failure(e.message ?: "Network error. Check your connection.")
        }
    }

    suspend fun logoutDevice(refreshToken: String): AuthResult<LogoutResponse> {
        return try {
            val response = ApiClient.authApiService.logoutDevice(LogoutRequest(refreshToken))
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    SessionManager.clear()
                    AuthResult.Success(body)
                }
                else AuthResult.Failure("Empty response body")
            } else {
                val errBody = response.errorBody()?.string()
                AuthResult.Failure(errBody ?: "Logout failed (${response.code()})")
            }
        } catch (e: Exception) {
            AuthResult.Failure(e.message ?: "Network error. Check your connection.")
        }
    }
}

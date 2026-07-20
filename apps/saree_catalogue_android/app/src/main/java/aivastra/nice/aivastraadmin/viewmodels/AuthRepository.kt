package aivastra.nice.aivastraadmin.viewmodels

import aivastra.nice.aivastraadmin.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Login.UserSession
import com.example.facewixlatest.ApiUtils.APICaller
import com.example.facewixlatest.ApiUtils.APIConstant
import com.example.facewixlatest.ApiUtils.ApiException
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject

object AuthRepository {
    private val mapper = ObjectMapper()

    suspend fun deviceLogin(email: String, password: String, deviceId: String): UserSession {
        val body = JSONObject().apply {
            put("email", email)
            put("password", password)
            put("deviceId", deviceId)
            put("platform", "mobile")
        }.toString()
        val response = APICaller.postJson(APIConstant.API_ENDPOINTS.DEVICE_LOGIN, body)
        return mapper.readValue(response, UserSession::class.java)
    }

    suspend fun deviceLogout() {
        val refreshToken = PrefsManager.getRefreshToken()
        if (refreshToken.isBlank()) return
        val body = JSONObject().apply {
            put("refreshToken", refreshToken)
        }.toString()
        APICaller.postJson(APIConstant.API_ENDPOINTS.DEVICE_LOGOUT, body)
    }

    /** Maps a caught ApiException to a user-facing message. */
    fun errorMessage(e: Throwable): String = when (e) {
        is ApiException.BackendError -> e.backendMessage
        is ApiException.NetworkError -> APIConstant.serverTimeOut
        is ApiException.ClientError -> e.message ?: APIConstant.errorSomethingWrong
        else -> APIConstant.errorSomethingWrong
    }
}
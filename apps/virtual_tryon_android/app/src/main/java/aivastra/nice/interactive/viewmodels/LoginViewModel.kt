package aivastra.nice.interactive.viewmodels

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.auth.GoogleSignInResult
import aivastra.nice.interactive.auth.requestGoogleIdToken
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.data.models.ActiveDevice
import aivastra.nice.interactive.data.models.DeviceLoginRequest
import aivastra.nice.interactive.data.models.DeviceLoginResponse
import aivastra.nice.interactive.data.models.ForceLoginRequest
import aivastra.nice.interactive.data.models.GoogleLoginRequest
import aivastra.nice.interactive.data.repository.AuthResult
import aivastra.nice.interactive.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// ─── UI State ────────────────────────────────────────────────────────────────

sealed interface LoginUiState {
    object Idle : LoginUiState
    object Loading : LoginUiState
    data class Success(val response: DeviceLoginResponse) : LoginUiState
    data class Error(val message: String) : LoginUiState
    data class DeviceLimitReached(
        val forceLogoutToken: String,
        val maxActiveDevices: Int,
        val activeDevices: List<ActiveDevice>
    ) : LoginUiState
}

// ─── ViewModel ───────────────────────────────────────────────────────────────

class LoginViewModel(
    private val repository: UserRepository = UserRepository()
) : ViewModel() {

    private val _uiState = MutableStateFlow<LoginUiState>(LoginUiState.Idle)
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    /** Cached device info for subsequent force-login call */
    private var cachedDeviceId: String = "23dsfsdf"
    private var cachedDeviceName: String = "vido"
    private val platform: String = "kiosk"

    // ─── Login ─────────────────────────────────────────────────────────────

    fun login(
        email: String,
        password: String,
        deviceId: String = cachedDeviceId,
        deviceName: String = cachedDeviceName
    ) {
        if (email.trim().isEmpty() || password.trim().isEmpty()) {
            _uiState.update { LoginUiState.Error("Email and password cannot be empty") }
            return
        }

        cachedDeviceId = deviceId
        cachedDeviceName = deviceName
        _uiState.update { LoginUiState.Loading }

        viewModelScope.launch {
            val result = repository.loginDevice(
                DeviceLoginRequest(
                    email = email.trim(),
                    password = password.trim(),
                    deviceId = deviceId,
                    deviceName = deviceName,
                    platform = platform
                )
            )

            _uiState.update {
                when (result) {
                    is AuthResult.Success -> {
                        SessionManager.save(
                            accessToken = result.data.accessToken,
                            refreshToken = result.data.refreshToken,
                            email = result.data.user.email,
                            userName = result.data.user.displayName,
                            logoUrl = result.data.effectiveLogoUrl
                        )
                        LoginUiState.Success(result.data)
                    }
                    is AuthResult.DeviceLimitReached -> {
                        val err = result.error.error
                        LoginUiState.DeviceLimitReached(
                            forceLogoutToken = err.forceLogoutToken,
                            maxActiveDevices = err.maxActiveDevices,
                            activeDevices = err.activeDevices
                        )
                    }
                    is AuthResult.Failure -> LoginUiState.Error(result.message)
                }
            }
        }
    }

    // ─── Google Sign-In ────────────────────────────────────────────────────

    fun loginWithGoogle(
        context: Context,
        deviceId: String = cachedDeviceId,
        deviceName: String = cachedDeviceName
    ) {
        cachedDeviceId = deviceId
        cachedDeviceName = deviceName
        _uiState.update { LoginUiState.Loading }

        viewModelScope.launch {
            when (val credential = requestGoogleIdToken(context)) {
                is GoogleSignInResult.Cancelled -> {
                    _uiState.update { LoginUiState.Idle }
                }
                is GoogleSignInResult.Failure -> {
                    _uiState.update { LoginUiState.Error(credential.message) }
                }
                is GoogleSignInResult.Success -> {
                    val result = repository.loginGoogle(
                        GoogleLoginRequest(
                            idToken = credential.idToken,
                            deviceId = deviceId,
                            deviceName = deviceName,
                            platform = platform
                        )
                    )

                    _uiState.update {
                        when (result) {
                            is AuthResult.Success -> {
                                SessionManager.save(
                                    accessToken = result.data.accessToken,
                                    refreshToken = result.data.refreshToken,
                                    email = result.data.user.email,
                                    userName = result.data.user.displayName,
                                    logoUrl = result.data.effectiveLogoUrl
                                )
                                LoginUiState.Success(result.data)
                            }
                            is AuthResult.DeviceLimitReached -> {
                                val err = result.error.error
                                LoginUiState.DeviceLimitReached(
                                    forceLogoutToken = err.forceLogoutToken,
                                    maxActiveDevices = err.maxActiveDevices,
                                    activeDevices = err.activeDevices
                                )
                            }
                            is AuthResult.Failure -> LoginUiState.Error(result.message)
                        }
                    }
                }
            }
        }
    }

    // ─── Force Login (kick other devices) ─────────────────────────────────

    fun forceLogin(forceLogoutToken: String) {
        _uiState.update { LoginUiState.Loading }

        viewModelScope.launch {
            val result = repository.forceLogin(
                ForceLoginRequest(
                    forceLogoutToken = forceLogoutToken,
                    deviceId = cachedDeviceId,
                    deviceName = cachedDeviceName,
                    platform = platform
                )
            )

            _uiState.update {
                when (result) {
                    is AuthResult.Success -> {
                        SessionManager.save(
                            accessToken = result.data.accessToken,
                            refreshToken = result.data.refreshToken,
                            email = result.data.user.email,
                            userName = result.data.user.displayName,
                            logoUrl = result.data.effectiveLogoUrl
                        )
                        LoginUiState.Success(result.data)
                    }
                    is AuthResult.DeviceLimitReached -> LoginUiState.Error("Unexpected conflict during force login")
                    is AuthResult.Failure -> LoginUiState.Error(result.message)
                }
            }
        }
    }

    // ─── State helpers ─────────────────────────────────────────────────────

    fun resetToIdle() {
        _uiState.update { LoginUiState.Idle }
    }

    fun dismissError() {
        _uiState.update { LoginUiState.Idle }
    }
}

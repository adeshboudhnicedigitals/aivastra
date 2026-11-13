package aivastra.nice.interactive.viewmodels

import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.auth.GoogleSignInResult
import aivastra.nice.interactive.auth.legacyGoogleSignInIntent
import aivastra.nice.interactive.auth.parseLegacyGoogleResult
import aivastra.nice.interactive.auth.requestGoogleIdToken
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.data.models.ActiveDevice
import aivastra.nice.interactive.data.models.DeviceLoginRequest
import aivastra.nice.interactive.data.models.DeviceLoginResponse
import aivastra.nice.interactive.data.models.ForceLoginRequest
import aivastra.nice.interactive.data.models.GoogleLoginRequest
import aivastra.nice.interactive.data.repository.AuthResult
import aivastra.nice.interactive.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
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

    // One-shot: the legacy Google chooser intent for the page to launch (needs an Activity result
    // launcher, which a ViewModel can't own). Buffered so an emit before collection isn't dropped.
    private val _legacyGoogleIntents = MutableSharedFlow<Intent>(extraBufferCapacity = 1)
    val legacyGoogleIntents: SharedFlow<Intent> = _legacyGoogleIntents.asSharedFlow()

    // Cached device info for the subsequent force-login call — populated by login()/
    // loginWithGoogle() before forceLogin() can ever become reachable (it only fires from a
    // DeviceLimitReached state that those two produce), so these defaults are never actually used.
    private var cachedDeviceId: String = ""
    private var cachedDeviceName: String = ""
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
            try {
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
                                userId = result.data.user.id,
                                email = result.data.user.email,
                                userName = result.data.user.displayName,
                                logoUrl = result.data.effectiveLogoUrl,
                                loadingVideoUrl = result.data.effectiveLoadingVideoUrl,
                                isLogin = true
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
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { LoginUiState.Error(e.message ?: "An unexpected error occurred during login") }
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
            try {
                when (val credential = requestGoogleIdToken(context)) {
                    is GoogleSignInResult.Cancelled -> {
                        _uiState.update { LoginUiState.Idle }
                    }
                    is GoogleSignInResult.Failure -> {
                        _uiState.update { LoginUiState.Error(credential.message) }
                    }
                    is GoogleSignInResult.UseLegacy -> {
                        // Credential Manager hung or errored on this device. Stay in Loading and
                        // hand the page the legacy chooser intent to launch; its result comes
                        // back through completeLegacyGoogleLogin().
                        val intent = try {
                            legacyGoogleSignInIntent(context)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            _uiState.update {
                                LoginUiState.Error("Google sign-in isn't available on this device. Please sign in with email.")
                            }
                            return@launch
                        }
                        _legacyGoogleIntents.emit(intent)
                    }
                    is GoogleSignInResult.Success -> finishGoogleLogin(credential.idToken, deviceId, deviceName)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { LoginUiState.Error(e.message ?: "Google sign-in error occurred") }
            }
        }
    }

    /** Called by the sign-in page with the legacy chooser's activity result. */
    fun completeLegacyGoogleLogin(resultCode: Int, data: Intent?) {
        viewModelScope.launch {
            try {
                when (val credential = parseLegacyGoogleResult(resultCode, data)) {
                    is GoogleSignInResult.Success ->
                        finishGoogleLogin(credential.idToken, cachedDeviceId, cachedDeviceName)
                    is GoogleSignInResult.Failure -> _uiState.update { LoginUiState.Error(credential.message) }
                    else -> _uiState.update { LoginUiState.Idle } // cancelled
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { LoginUiState.Error(e.message ?: "Google sign-in error occurred") }
            }
        }
    }

    private suspend fun finishGoogleLogin(idToken: String, deviceId: String, deviceName: String) {
        val result = repository.loginGoogle(
            GoogleLoginRequest(
                idToken = idToken,
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
                        userId = result.data.user.id,
                        email = result.data.user.email,
                        userName = result.data.user.displayName,
                        logoUrl = result.data.effectiveLogoUrl,
                        loadingVideoUrl = result.data.effectiveLoadingVideoUrl,
                        isLogin = true
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

    // ─── Force Login (kick other devices) ─────────────────────────────────

    fun forceLogin(forceLogoutToken: String) {
        _uiState.update { LoginUiState.Loading }

        viewModelScope.launch {
            try {
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
                                userId = result.data.user.id,
                                email = result.data.user.email,
                                userName = result.data.user.displayName,
                                logoUrl = result.data.effectiveLogoUrl,
                                loadingVideoUrl = result.data.effectiveLoadingVideoUrl,
                                isLogin = true
                            )
                            LoginUiState.Success(result.data)
                        }
                        is AuthResult.DeviceLimitReached -> LoginUiState.Error("Unexpected conflict during force login")
                        is AuthResult.Failure -> LoginUiState.Error(result.message)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { LoginUiState.Error(e.message ?: "Force login error occurred") }
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

    /** Surfaces a client-side failure (e.g. Google Sign-In) that never reached the repository. */
    fun reportError(message: String) {
        _uiState.update { LoginUiState.Error(message) }
    }
}

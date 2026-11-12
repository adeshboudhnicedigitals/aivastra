package aivastra.nice.interactive.device

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * The tablet's identity: the long-lived device token from pairing (HLD §5.1). Private app
 * preferences, same storage the owner app used for its tokens. Merchant, branch and staff are
 * never trusted from here by the server; the token alone decides them.
 */
object DeviceStore {
    private const val PREFS = "ai_vastra_device"
    private const val TOKEN = "device_token"
    private const val NAME = "device_name"

    private lateinit var appContext: Context
    private val prefs get() = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _paired = MutableStateFlow(false)
    /** Flips to false when the server stops recognising the token, so the UI returns to pairing. */
    val paired: StateFlow<Boolean> = _paired.asStateFlow()

    fun initialize(context: Context) {
        appContext = context.applicationContext
        _paired.value = !token.isNullOrBlank()
    }

    val token: String? get() = if (::appContext.isInitialized) prefs.getString(TOKEN, null) else null
    val deviceName: String? get() = if (::appContext.isInitialized) prefs.getString(NAME, null) else null

    fun save(token: String, name: String) {
        prefs.edit().putString(TOKEN, token).putString(NAME, name).apply()
        _paired.value = true
    }

    /** Device deactivated or unpaired: forget the token and everything tied to it. */
    fun clear() {
        if (::appContext.isInitialized) prefs.edit().clear().apply()
        StaffSession.signOut()
        InstoreSession.forget()
        _paired.value = false
    }
}

/**
 * A staff member signed in on this shared tablet (assisted mode). In memory only: no refresh
 * token is kept on a shared device, so an expired token means signing in again (plan M3).
 */
object StaffSession {
    private const val EXPIRY_SKEW_SECONDS = 30L

    private val _email = MutableStateFlow<String?>(null)
    /** Who is signed in, for the UI; null in kiosk mode. */
    val email: StateFlow<String?> = _email.asStateFlow()

    @Volatile private var accessToken: String? = null

    val isSignedIn: Boolean get() = _email.value != null

    fun signIn(email: String, token: String) {
        accessToken = token
        _email.value = email
    }

    fun signOut() {
        accessToken = null
        _email.value = null
    }

    /** The token if it is still valid, else null (the caller asks for a fresh sign-in). */
    fun validToken(nowSeconds: Long = System.currentTimeMillis() / 1000): String? {
        val t = accessToken ?: return null
        val exp = jwtExpiry(t) ?: return t
        return if (exp - EXPIRY_SKEW_SECONDS > nowSeconds) t else null
    }

    private fun jwtExpiry(token: String): Long? =
        try {
            val payload = token.split(".")[1]
            val json = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            JSONObject(json).optLong("exp").takeIf { it > 0 }
        } catch (_: Exception) {
            null
        }
}

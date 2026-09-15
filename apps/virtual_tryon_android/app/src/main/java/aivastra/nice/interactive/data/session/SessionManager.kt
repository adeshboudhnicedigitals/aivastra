package aivastra.nice.interactive.data.session

import android.content.Context
import android.util.Base64
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.data.repository.CatalogRepository
import aivastra.nice.interactive.utils.CrashReporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Process-wide session source. Preferences are private to the app; callers never
 * read or write token keys directly.
 */
object SessionManager {
    private const val PREFS_NAME = "ai_vastra_session"
    private const val ACCESS_TOKEN = "access_token"
    private const val REFRESH_TOKEN = "refresh_token"
    private const val USER_ID = "user_id"
    private const val USER_EMAIL = "user_email"
    private const val USER_NAME = "user_name"
    private const val USER_LOGO_URL = "user_logo_url"
    private const val USER_LOADING_VIDEO_URL = "user_loading_video_url"
    private const val EXPIRY_SKEW_SECONDS = 30L

    private lateinit var appContext: Context

    fun initialize(context: Context) {
        appContext = context.applicationContext
        ApiClient.setAccessToken(accessToken)
        CrashReporter.setUserId(userId)
    }

    private val preferences
        get() = if (::appContext.isInitialized) appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) else null

    val accessToken: String?
        get() = preferences?.getString(ACCESS_TOKEN, null)

    val refreshToken: String?
        get() = preferences?.getString(REFRESH_TOKEN, null)

    val userId: String?
        get() = preferences?.getString(USER_ID, null)

    val userEmail: String?
        get() = preferences?.getString(USER_EMAIL, null)

    val userName: String?
        get() = preferences?.getString(USER_NAME, null)

    val logoUrl: String?
        get() = preferences?.getString(USER_LOGO_URL, null)

    val loadingVideoUrl: String?
        get() = preferences?.getString(USER_LOADING_VIDEO_URL, null)

    // Bumped only on a fresh login (see save()'s isLogin param). Two things key off this:
    // AppVideoViewModel re-fetches the processing-screen video for the newly signed-in
    // merchant instead of only fetching once at app-process start, and AppHeaderLogo folds it
    // into Coil's cache key so a merchant's re-uploaded logo (same URL, new bytes) isn't served
    // stale from disk cache across a login. Token refresh must never bump this — it would
    // re-download both on every silent refresh for no reason.
    private val _loadingVideoVersion = MutableStateFlow(0)
    val loadingVideoVersion: StateFlow<Int> = _loadingVideoVersion.asStateFlow()

    @JvmOverloads
    fun save(
        accessToken: String,
        refreshToken: String? = null,
        userId: String? = null,
        email: String? = null,
        userName: String? = null,
        logoUrl: String? = null,
        loadingVideoUrl: String? = null,
        // True only from the login/google-login/force-login call sites. A fresh login's
        // loadingVideoUrl is authoritative for the signed-in merchant, so it must be written
        // (or cleared, if the merchant has no override) even when null — unlike the token
        // refresh call site, which never sends this field and must leave the last-known value
        // alone rather than wiping it out.
        isLogin: Boolean = false
    ) {
        val prefs = preferences ?: return
        val editor = prefs.edit()
            .putString(ACCESS_TOKEN, accessToken)
        if (!refreshToken.isNullOrEmpty()) {
            editor.putString(REFRESH_TOKEN, refreshToken)
        }
        if (!userId.isNullOrEmpty()) {
            editor.putString(USER_ID, userId)
        }
        if (!email.isNullOrEmpty()) {
            editor.putString(USER_EMAIL, email)
        }
        if (!userName.isNullOrEmpty()) {
            editor.putString(USER_NAME, userName)
        }
        // Same isLogin split as loadingVideoUrl below: a fresh login's logoUrl is authoritative
        // for the signed-in merchant and must be cleared when blank (merchant removed their
        // custom logo), while a token refresh never sends this field and must leave the
        // last-known value alone rather than wiping it out.
        if (isLogin) {
            if (logoUrl.isNullOrEmpty()) {
                editor.remove(USER_LOGO_URL)
            } else {
                editor.putString(USER_LOGO_URL, logoUrl)
            }
        } else if (!logoUrl.isNullOrEmpty()) {
            editor.putString(USER_LOGO_URL, logoUrl)
        }
        if (isLogin) {
            if (loadingVideoUrl.isNullOrEmpty()) {
                editor.remove(USER_LOADING_VIDEO_URL)
            } else {
                editor.putString(USER_LOADING_VIDEO_URL, loadingVideoUrl)
            }
        } else if (!loadingVideoUrl.isNullOrEmpty()) {
            editor.putString(USER_LOADING_VIDEO_URL, loadingVideoUrl)
        }
        editor.apply()
        ApiClient.setAccessToken(accessToken)
        CatalogRepository.clearCache()
        // Non-PII opaque id only — never the email — so crash reports can be
        // correlated with a user for support triage without logging PII to Crashlytics.
        CrashReporter.setUserId(userId ?: SessionManager.userId)
        if (isLogin) {
            _loadingVideoVersion.value++
        }
    }

    fun clear() {
        preferences?.edit()?.clear()?.apply()
        ApiClient.setAccessToken(null)
        CatalogRepository.clearCache()
        CrashReporter.setUserId(null)
    }

    fun hasValidSession(): Boolean {
        val token = accessToken
        val refresh = refreshToken
        return !token.isNullOrBlank() || !refresh.isNullOrBlank()
    }

    fun hasValidAccessToken(): Boolean {
        val token = accessToken ?: return false
        if (token.isBlank()) return false
        val expiry = tokenExpirySeconds(token) ?: return true
        return expiry > (System.currentTimeMillis() / 1000L) + EXPIRY_SKEW_SECONDS
    }

    private fun tokenExpirySeconds(token: String): Long? = runCatching {
        val payload = token.split('.')[1]
        val decoded = Base64.decode(
            payload,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        )
        JSONObject(String(decoded, Charsets.UTF_8)).getLong("exp")
    }.getOrNull()
}

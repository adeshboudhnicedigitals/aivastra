package aivastra.nice.interactive.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.auth.api.signin.GoogleSignInStatusCodes
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.tasks.Task
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.security.SecureRandom
import kotlin.coroutines.resume

/**
 * Web (not Android-type) OAuth client id. Credential Manager's serverClientId must be
 * the exact same client id the backend verifies the Google ID token's `aud` claim
 * against (GOOGLE_CLIENT_ID in apps/api) — an Android-type client id here would
 * produce a token the backend rejects as INVALID_GOOGLE_TOKEN. The legacy fallback below
 * uses the same id for the same reason.
 */
private const val GOOGLE_WEB_CLIENT_ID =
    "35415564946-g67lkjr3oso891lovqjaffqfd3gbhllq.apps.googleusercontent.com"

sealed interface GoogleSignInResult {
    data class Success(val idToken: String) : GoogleSignInResult
    data class Failure(val message: String) : GoogleSignInResult
    data object Cancelled : GoogleSignInResult

    /**
     * Credential Manager could not produce a token (it hung, or errored). The caller should
     * try the legacy Google Sign-In flow instead of surfacing an error straight away.
     */
    data class UseLegacy(val reason: String) : GoogleSignInResult
}

/**
 * On a cold app process, Credential Manager's provider binding (Play Services)
 * hasn't finished enumerating accounts yet and throws NoCredentialException even
 * though the device genuinely has Google accounts. Once the binding is warm,
 * later calls succeed immediately, so a couple of quick retries clear it up
 * without the user having to know to tap the button again.
 */
private const val NO_CREDENTIAL_MAX_ATTEMPTS = 3
private const val NO_CREDENTIAL_RETRY_DELAY_MS = 400L

/**
 * getCredential() has no timeout of its own, and on some devices (outdated/restricted Play
 * Services, stripped-down kiosk tablets) it never returns, leaving the sign-in spinner up
 * forever. Generous enough for a person to pick or add an account in the sheet; on expiry the
 * legacy flow takes over.
 */
private const val CREDENTIAL_MANAGER_TIMEOUT_MS = 30_000L

/** signOut() before the legacy chooser so it lists every account instead of auto-reusing one. */
private const val LEGACY_SIGN_OUT_TIMEOUT_MS = 3_000L

/**
 * Launches the Credential Manager Google sign-in sheet and returns the ID token to
 * hand to POST /v1/auth/device-login/google. This intentionally requests every
 * Google account available on the device so the chooser includes both existing
 * accounts and the "Add another account" entry for new sign-ins.
 *
 * Returns [GoogleSignInResult.UseLegacy] when Credential Manager hangs or errors, so the caller
 * can fall back to [legacyGoogleSignInIntent] rather than leave the user stuck.
 */
suspend fun requestGoogleIdToken(context: Context): GoogleSignInResult {
    val result = withTimeoutOrNull(CREDENTIAL_MANAGER_TIMEOUT_MS) {
        requestViaCredentialManager(context)
    }
    if (result == null) {
        Log.w("GoogleSignIn", "Credential Manager gave no response in ${CREDENTIAL_MANAGER_TIMEOUT_MS}ms; falling back")
        return GoogleSignInResult.UseLegacy("Credential Manager timed out")
    }
    return result
}

private suspend fun requestViaCredentialManager(context: Context): GoogleSignInResult {
    val credentialManager = CredentialManager.create(context)

    val option = GetGoogleIdOption.Builder()
        .setFilterByAuthorizedAccounts(false)
        .setServerClientId(GOOGLE_WEB_CLIENT_ID)
        .setAutoSelectEnabled(false)
        .setNonce(generateNonce())
        .build()

    val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()

    for (attempt in 1..NO_CREDENTIAL_MAX_ATTEMPTS) {
        try {
            val response = credentialManager.getCredential(context, request)
            val credential = response.credential
            return if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                GoogleSignInResult.Success(googleCredential.idToken)
            } else {
                GoogleSignInResult.UseLegacy("Unexpected credential type")
            }
        } catch (e: GoogleIdTokenParsingException) {
            Log.e("GoogleSignIn", "Token parsing failed", e)
            return GoogleSignInResult.Failure("Invalid Google credential")
        } catch (e: NoCredentialException) {
            Log.w(
                "GoogleSignIn",
                "NoCredentialException on attempt $attempt/$NO_CREDENTIAL_MAX_ATTEMPTS: ${e.type} ${e.message}",
                e,
            )
            if (attempt == NO_CREDENTIAL_MAX_ATTEMPTS) {
                // The legacy chooser can still offer "Add account", so try it before giving up.
                return GoogleSignInResult.UseLegacy("No credential from Credential Manager")
            }
            delay(NO_CREDENTIAL_RETRY_DELAY_MS)
        } catch (e: GetCredentialCancellationException) {
            return GoogleSignInResult.Cancelled
        } catch (e: GetCredentialException) {
            Log.e("GoogleSignIn", "GetCredentialException: ${e.type} ${e.message}", e)
            return GoogleSignInResult.UseLegacy(e.message ?: "Credential Manager failed")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e("GoogleSignIn", "Unexpected exception during Google sign-in: ${e.message}", e)
            return GoogleSignInResult.UseLegacy(e.message ?: "Google sign-in failed")
        }
    }
    // Unreachable: the loop always returns on the final attempt.
    return GoogleSignInResult.UseLegacy("No Google account available on this device")
}

// ─── Legacy fallback (play-services-auth GoogleSignInClient) ─────────────────

private fun legacyClient(context: Context): GoogleSignInClient {
    val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestIdToken(GOOGLE_WEB_CLIENT_ID)
        .requestEmail()
        .build()
    return GoogleSignIn.getClient(context, options)
}

/**
 * Intent for the legacy account chooser; launch it with an Activity Result launcher and feed the
 * result to [parseLegacyGoogleResult]. Signs out of any cached account first so a shared kiosk
 * always shows the chooser instead of silently reusing the previous person's account.
 */
suspend fun legacyGoogleSignInIntent(context: Context): Intent {
    val client = legacyClient(context)
    // Best effort: a slow or failed sign-out must not block the chooser from opening.
    withTimeoutOrNull(LEGACY_SIGN_OUT_TIMEOUT_MS) { runCatching { client.signOut().awaitTask() } }
    return client.signInIntent
}

fun parseLegacyGoogleResult(resultCode: Int, data: Intent?): GoogleSignInResult {
    if (resultCode == Activity.RESULT_CANCELED && data == null) return GoogleSignInResult.Cancelled
    return try {
        val account = GoogleSignIn.getSignedInAccountFromIntent(data).getResult(ApiException::class.java)
        val idToken = account.idToken
        if (idToken.isNullOrBlank()) {
            GoogleSignInResult.Failure("Google didn't return a sign-in token. Please try email sign-in.")
        } else {
            GoogleSignInResult.Success(idToken)
        }
    } catch (e: ApiException) {
        Log.e("GoogleSignIn", "Legacy sign-in failed: status=${e.statusCode}", e)
        if (e.statusCode == GoogleSignInStatusCodes.SIGN_IN_CANCELLED) {
            GoogleSignInResult.Cancelled
        } else {
            GoogleSignInResult.Failure(
                "Google sign-in isn't available on this device (code ${e.statusCode}). Please sign in with email."
            )
        }
    }
}

private suspend fun <T> Task<T>.awaitTask(): T? = suspendCancellableCoroutine { cont ->
    addOnCompleteListener { task -> if (cont.isActive) cont.resume(if (task.isSuccessful) task.result else null) }
}

private fun generateNonce(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
}

package aivastra.nice.interactive.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.security.SecureRandom

/**
 * Web (not Android-type) OAuth client id. Credential Manager's serverClientId must be
 * the exact same client id the backend verifies the Google ID token's `aud` claim
 * against (GOOGLE_CLIENT_ID in apps/api) — an Android-type client id here would
 * produce a token the backend rejects as INVALID_GOOGLE_TOKEN.
 */
private const val GOOGLE_WEB_CLIENT_ID =
    "35415564946-g67lkjr3oso891lovqjaffqfd3gbhllq.apps.googleusercontent.com"

sealed interface GoogleSignInResult {
    data class Success(val idToken: String) : GoogleSignInResult
    data class Failure(val message: String) : GoogleSignInResult
    data object Cancelled : GoogleSignInResult
}

/**
 * Launches the Credential Manager Google sign-in sheet and returns the ID token to
 * hand to POST /v1/auth/device-login/google. Tries accounts already used with this
 * app first, and only falls back to showing every Google account on the device when
 * none are found — Google's recommended two-pass pattern for returning users.
 */
suspend fun requestGoogleIdToken(context: Context): GoogleSignInResult {
    val credentialManager = CredentialManager.create(context)

    suspend fun attempt(filterByAuthorizedAccounts: Boolean): GoogleSignInResult {
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(filterByAuthorizedAccounts)
            .setServerClientId(GOOGLE_WEB_CLIENT_ID)
            .setAutoSelectEnabled(false)
            .setNonce(generateNonce())
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()

        return try {
            val response = credentialManager.getCredential(context, request)
            val credential = response.credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                GoogleSignInResult.Success(googleCredential.idToken)
            } else {
                GoogleSignInResult.Failure("Unexpected credential type")
            }
        } catch (e: GoogleIdTokenParsingException) {
            GoogleSignInResult.Failure("Invalid Google credential")
        } catch (e: NoCredentialException) {
            if (filterByAuthorizedAccounts) attempt(filterByAuthorizedAccounts = false)
            else GoogleSignInResult.Failure("No Google account available on this device")
        } catch (e: GetCredentialCancellationException) {
            GoogleSignInResult.Cancelled
        } catch (e: GetCredentialException) {
            GoogleSignInResult.Failure(e.message ?: "Google sign-in failed")
        }
    }

    return attempt(filterByAuthorizedAccounts = true)
}

private fun generateNonce(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
}

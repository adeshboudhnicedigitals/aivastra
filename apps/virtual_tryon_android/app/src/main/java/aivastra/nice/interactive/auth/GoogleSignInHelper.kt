package aivastra.nice.interactive.auth

import android.content.Context
import android.util.Log
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
 * against (GOOGLE_CLIENT_ID in apps/api) â€” an Android-type client id here would
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
 * hand to POST /v1/auth/device-login/google. This intentionally requests every
 * Google account available on the device so the chooser includes both existing
 * accounts and the "Add another account" entry for new sign-ins.
 */
suspend fun requestGoogleIdToken(context: Context): GoogleSignInResult {
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
        Log.e("GoogleSignIn", "Token parsing failed", e)
        GoogleSignInResult.Failure("Invalid Google credential")
    } catch (e: NoCredentialException) {
        Log.e("GoogleSignIn", "NoCredentialException: ${e.type} ${e.message}", e)
        GoogleSignInResult.Failure("No Google account available on this device")
    } catch (e: GetCredentialCancellationException) {
        GoogleSignInResult.Cancelled
    } catch (e: GetCredentialException) {
        Log.e("GoogleSignIn", "GetCredentialException: ${e.type} ${e.message}", e)
        GoogleSignInResult.Failure(e.message ?: "Google sign-in failed")
    } catch (e: Exception) {
        Log.e("GoogleSignIn", "Unexpected exception during Google sign-in: ${e.message}", e)
        GoogleSignInResult.Failure(e.message ?: "Google sign-in failed")
    }
}

private fun generateNonce(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
}

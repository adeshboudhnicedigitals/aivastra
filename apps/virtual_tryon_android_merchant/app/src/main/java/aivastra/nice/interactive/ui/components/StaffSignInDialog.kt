package aivastra.nice.interactive.ui.components

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.device.StaffLoginRequest
import aivastra.nice.interactive.device.StaffSession
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * A sales assistant signs in on the shared tablet with their Merchant Web account; sessions
 * started while signed in are their assisted sessions (HLD §5.3). The server checks that the
 * staff member belongs to this tablet's branch when the session starts, not here.
 */
@Composable
fun StaffSignInDialog(onDismiss: () -> Unit, onSignedIn: () -> Unit) {
    var email by remember { mutableStateOf(StaffSession.email.value ?: "") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Staff sign in", fontFamily = PoppinsFamily) },
        text = {
            Column {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it.trim() },
                    singleLine = true,
                    label = { Text("Email") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    singleLine = true,
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth()
                )
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = Color(0xFFFF6A4D))
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && email.isNotBlank() && password.isNotEmpty(),
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            val res = ApiClient.deviceApi.staffLogin(StaffLoginRequest(email, password))
                            val token = res.body()?.accessToken
                            if (res.isSuccessful && !token.isNullOrBlank()) {
                                StaffSession.signIn(email, token)
                                onSignedIn()
                            } else {
                                error = when (res.code()) {
                                    401 -> "Wrong email or password."
                                    403 -> "This account can't sign in here."
                                    429 -> "Too many attempts. Wait a minute and try again."
                                    else -> "Sign-in failed (${res.code()})."
                                }
                            }
                        } catch (_: IOException) {
                            error = "No connection. Check the network and try again."
                        } finally {
                            password = ""
                            busy = false
                        }
                    }
                }
            ) { Text(if (busy) "Signing in…" else "Sign in") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } }
    )
}

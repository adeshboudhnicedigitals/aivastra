package aivastra.nice.interactive.ui.screens

import aivastra.nice.interactive.R
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.device.DeviceStore
import aivastra.nice.interactive.device.PairRequest
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import aivastra.nice.interactive.ui.components.GradientButton
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.ErrorParser
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * First run, or after the device was deactivated: the merchant admin creates a device in
 * Merchant Web (Devices → Add device) and types the one-time code shown there (HLD §5.1).
 */
@Composable
fun PairingPage(onPaired: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val submit: () -> Unit = submit@{
        val trimmed = code.trim().uppercase()
        if (trimmed.length < 6 || busy) return@submit
        busy = true
        error = null
        scope.launch {
            try {
                val res = ApiClient.deviceApi.pair(PairRequest(trimmed))
                val body = res.body()
                if (res.isSuccessful && body != null) {
                    DeviceStore.save(body.token, body.name)
                    onPaired()
                } else {
                    // One generic 400 for every failure server-side (wrong, used or expired code).
                    error = if (res.code() == 400) "That code is wrong or has expired. Ask your admin for a new one."
                    else ErrorParser.parseErrorMessage(res, "Pairing failed. Try again.")
                }
            } catch (_: IOException) {
                error = "No connection. Check the network and try again."
            } finally {
                busy = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Image(
            painter = painterResource(R.drawable.new_app_bg),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .padding(horizontal = sdp(R.dimen._24sdp)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AppHeaderLogo(logoUrl = null)
            Spacer(Modifier.height(sdp(R.dimen._16sdp)))
            Text(
                "Pair this tablet",
                color = Color.White,
                fontSize = ssp(R.dimen._22ssp),
                fontWeight = FontWeight.Bold,
                fontFamily = PoppinsFamily
            )
            Spacer(Modifier.height(sdp(R.dimen._6sdp)))
            Text(
                "In Merchant Web, open Devices, add this tablet to a branch, and enter the code shown there.",
                color = Color(0xFFD9D9D9),
                fontSize = ssp(R.dimen._12ssp),
                fontFamily = PoppinsFamily,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(sdp(R.dimen._16sdp)))
            OutlinedTextField(
                value = code,
                onValueChange = { v -> code = v.filter { it.isLetterOrDigit() }.take(16).uppercase() },
                singleLine = true,
                label = { Text("Pairing code", fontFamily = PoppinsFamily) },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedLabelColor = Color(0xFFD88A18),
                    unfocusedLabelColor = Color(0xFFBDBDBD),
                    focusedBorderColor = Color(0xFFD88A18),
                    unfocusedBorderColor = Color.White.copy(alpha = 0.3f),
                    cursorColor = Color(0xFFD88A18)
                ),
                modifier = Modifier.fillMaxWidth()
            )
            error?.let {
                Spacer(Modifier.height(sdp(R.dimen._8sdp)))
                Text(it, color = Color(0xFFFF6A4D), fontSize = ssp(R.dimen._11ssp), fontFamily = PoppinsFamily)
            }
            Spacer(Modifier.height(sdp(R.dimen._16sdp)))
            GradientButton(
                onClick = submit,
                enabled = !busy && code.trim().length >= 6,
                width = 0.dp,
                height = sdp(R.dimen._44sdp)
            ) {
                if (busy) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.height(sdp(R.dimen._18sdp)))
                } else {
                    Text("Pair tablet", color = Color.White, fontWeight = FontWeight.Bold, fontFamily = PoppinsFamily)
                }
            }
        }
    }
}

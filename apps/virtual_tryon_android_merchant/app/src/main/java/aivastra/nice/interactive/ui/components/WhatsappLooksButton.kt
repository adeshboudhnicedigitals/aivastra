package aivastra.nice.interactive.ui.components

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.device.EventReporter
import aivastra.nice.interactive.device.InstoreSession
import aivastra.nice.interactive.ui.screens.QrCodeImage
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * "Get these looks on WhatsApp" (CRM spec §5, decision A1). The QR opens WhatsApp on the
 * shopper's phone to the BRAND's number with `LOOKS <code>` prefilled; sending it verifies the
 * number and the brand's number replies with the consent question and the looks. Where the
 * store has not set WhatsApp up, the existing download QR (mode C) is the way home.
 */
@Composable
fun WhatsappLooksButton(modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var link by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("pending") }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Text(
        if (busy) "Preparing…" else "Get looks on WhatsApp",
        color = Color.White,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        fontFamily = PoppinsFamily,
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Color(0xFF128C7E))
            .clickable(enabled = !busy) {
                busy = true
                note = null
                scope.launch {
                    try {
                        val sid = InstoreSession.id
                        if (sid == null) {
                            note = "Start a try-on first."
                            return@launch
                        }
                        val res = ApiClient.deviceApi.identifyStart(sid)
                        val body = res.body()
                        when {
                            res.isSuccessful && body != null -> {
                                status = "pending"
                                link = body.waLink
                                EventReporter.identifyShown()
                            }
                            res.code() == 409 -> note = "WhatsApp delivery isn't set up for this store. Use the download QR."
                            else -> note = "Couldn't prepare the WhatsApp code (${res.code()})."
                        }
                    } catch (_: IOException) {
                        note = "No connection."
                    } finally {
                        busy = false
                    }
                }
            }
            .padding(horizontal = 14.dp, vertical = 8.dp)
    )
    note?.let { msg ->
        AlertDialog(
            onDismissRequest = { note = null },
            text = { Text(msg, fontFamily = PoppinsFamily) },
            confirmButton = { TextButton(onClick = { note = null }) { Text("OK") } }
        )
    }

    val current = link ?: return
    // Poll while the QR is up, so the screen confirms the moment the shopper's message lands.
    LaunchedEffect(current) {
        val sid = InstoreSession.id ?: return@LaunchedEffect
        while (status == "pending") {
            delay(3_000)
            try {
                ApiClient.deviceApi.identifyStatus(sid).body()?.let { status = it.status }
            } catch (_: IOException) {
                // Keep polling: the shopper may still send it.
            }
        }
    }
    AlertDialog(
        onDismissRequest = { link = null },
        title = { Text("Get these looks on WhatsApp", fontFamily = PoppinsFamily) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                when (status) {
                    "verified" -> Text(
                        "Sent! Check WhatsApp for your looks.",
                        fontFamily = PoppinsFamily,
                        textAlign = TextAlign.Center
                    )
                    "expired" -> Text(
                        "This code has expired. Close and tap the button again.",
                        fontFamily = PoppinsFamily,
                        textAlign = TextAlign.Center
                    )
                    else -> {
                        QrCodeImage(content = current, modifier = Modifier.size(220.dp))
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Scan with your phone camera, then press send in WhatsApp.",
                            fontFamily = PoppinsFamily,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { link = null }) { Text("Close") } }
    )
}

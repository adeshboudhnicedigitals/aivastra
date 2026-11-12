package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.models.RenewalPromptResponse
import aivastra.nice.interactive.ui.theme.ButtonGradientCenter
import aivastra.nice.interactive.ui.theme.ButtonGradientEnd
import aivastra.nice.interactive.ui.theme.ButtonGradientStart
import aivastra.nice.interactive.ui.theme.PoppinsFamily

// App palette: same near-black card and amber-gold accent as the other dialogs
// (SessionInterruptedDialog, ExitSessionDialog) and the gold GradientButton.
private val CardColor = Color(0xFF1A1A1A)
private val Gold = Color(0xFFE7A52C)
private val BorderBrush = Brush.linearGradient(
    listOf(ButtonGradientStart, ButtonGradientCenter, ButtonGradientEnd)
)
private val WhatsappGreen = Color(0xFF25D366) // brand colour, kept recognisable
private val EmailGold = Gold

/**
 * Server-driven "Subscription Expired" popup. Every string comes from [prompt]; nothing is
 * hardcoded so the wording can change from the admin panel without a release.
 *
 * The popup gates entry to a category, so closing it (back press / outside tap) only returns
 * the user to the category screen — they can still reach Profile and log out, and the next
 * category tap shows it again. [RenewalPromptResponse.blocking] false additionally shows an
 * explicit "Later" button.
 */
@Composable
fun RenewalPromptDialog(
    prompt: RenewalPromptResponse,
    onRenew: () -> Unit,
    onDismiss: () -> Unit
) {
    val uriHandler = LocalUriHandler.current
    val blocking = prompt.blocking
    // A device without WhatsApp / a mail app has nothing to handle the link; ignore the tap
    // rather than crash a kiosk that is already locked behind this popup.
    fun open(uri: String) { runCatching { uriHandler.openUri(uri) } }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnBackPress = true,
            dismissOnClickOutside = true,
            usePlatformDefaultWidth = false
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.88f)
                .widthIn(max = 460.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(CardColor)
                .border(BorderStroke(2.dp, BorderBrush), RoundedCornerShape(24.dp))
                .padding(horizontal = 24.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Image(
                painter = painterResource(R.drawable.ai_vastra_new_logo),
                contentDescription = null,
                modifier = Modifier.height(36.dp)
            )
            Spacer(Modifier.height(14.dp))
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF1E1609))
                    .border(1.5.dp, Gold.copy(alpha = 0.6f), RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Lock, contentDescription = null, tint = Gold, modifier = Modifier.size(26.dp))
            }

            prompt.title?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(14.dp))
                Text(
                    text = it,
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = Color.White,
                    textAlign = TextAlign.Center
                )
            }
            prompt.message?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = it,
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 14.sp,
                    color = Color.White.copy(alpha = 0.9f),
                    textAlign = TextAlign.Center
                )
            }

            val whatsapp = prompt.supportWhatsapp?.takeIf { it.isNotBlank() }
            val email = prompt.supportEmail?.takeIf { it.isNotBlank() }
            if (whatsapp != null || email != null) {
                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.15f)))
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "For any help, contact us:",
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = Color.White
                )
                Spacer(Modifier.height(8.dp))
                if (whatsapp != null) {
                    ContactRow(
                        icon = Icons.Default.Phone,
                        tint = WhatsappGreen,
                        text = "WhatsApp: $whatsapp",
                        onClick = {
                            val digits = whatsapp.filter { it.isDigit() }
                            if (digits.isNotEmpty()) open("https://wa.me/$digits")
                        }
                    )
                }
                if (email != null) {
                    ContactRow(
                        icon = Icons.Default.Email,
                        tint = EmailGold,
                        text = email,
                        onClick = { open("mailto:$email") }
                    )
                }
            }

            Spacer(Modifier.height(18.dp))
            GradientButton(
                onClick = onRenew,
                width = 0.dp,
                height = 48.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = prompt.ctaLabel?.takeIf { it.isNotBlank() } ?: "Renew",
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = Color.White
                )
            }
            if (!blocking) {
                Spacer(Modifier.height(10.dp))
                ExitDialogSecondaryButton(text = "Later", onClick = onDismiss)
            }
        }
    }
}

@Composable
private fun ContactRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
    text: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier.size(24.dp).clip(CircleShape).background(tint),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
        }
        Text(
            text = text,
            fontFamily = PoppinsFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = Color.White
        )
    }
}

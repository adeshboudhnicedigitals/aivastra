package aivastra.nice.interactive.ui.components

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.CrashReporter

private val Purple = Color(0xFFB026FF)
private val Blue = Color(0xFF3B6CF6)
private val Pink = Color(0xFFE040FB)
private val WhatsAppGreen = Color(0xFF25D366)

/**
 * "Subscription expired" popup, styled to the approved design: Ai Vastra logo, lock
 * badge, server-provided copy, support contacts and a gradient renew button inside a
 * pink→blue gradient border. Always Ai Vastra-branded (not the merchant's logo) — it
 * is Ai Vastra billing the merchant.
 *
 * @param blocking  true = no back/outside dismiss and no "Later" link; renewing (or the
 *                  support contacts) are the only ways forward.
 */
@Composable
fun RenewalPromptDialog(
    title: String,
    message: String?,
    ctaLabel: String,
    supportWhatsapp: String?,
    supportEmail: String?,
    blocking: Boolean,
    onRenew: () -> Unit,
    onLater: () -> Unit
) {
    val context = LocalContext.current
    fun open(uri: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
        } catch (e: Exception) {
            // No WhatsApp/mail app installed — nothing to open, leave the popup as is.
            CrashReporter.recordException(e, "RenewalPromptDialog")
        }
    }

    Dialog(
        onDismissRequest = { if (!blocking) onLater() },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = !blocking,
            dismissOnClickOutside = !blocking
        )
    ) {
        val shape = RoundedCornerShape(24.dp)
        Box(
            modifier = Modifier
                .fillMaxWidth(0.88f)
                .widthIn(max = 520.dp)
                .clip(shape)
                .background(Color(0xFF14141A))
                .border(2.dp, Brush.linearGradient(listOf(Pink, Purple, Blue)), shape)
                .padding(horizontal = 24.dp, vertical = 24.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Image(
                    painter = painterResource(R.drawable.ai_vastra_new_logo),
                    contentDescription = "Ai Vastra",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.height(32.dp)
                )
                Spacer(Modifier.height(16.dp))
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Brush.linearGradient(listOf(Purple, Color(0xFF6A3DF0)))),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Filled.Lock, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    text = title,
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = Color.White,
                    textAlign = TextAlign.Center
                )
                if (!message.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = message,
                        fontFamily = PoppinsFamily,
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        color = Color.White.copy(alpha = 0.9f),
                        textAlign = TextAlign.Center
                    )
                }

                if (!supportWhatsapp.isNullOrBlank() || !supportEmail.isNullOrBlank()) {
                    Spacer(Modifier.height(16.dp))
                    HorizontalDivider(color = Color.White.copy(alpha = 0.15f))
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = "For any help, contact us:",
                        fontFamily = PoppinsFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = Color.White
                    )
                    Spacer(Modifier.height(8.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!supportWhatsapp.isNullOrBlank()) {
                            // wa.me wants digits only, country code included.
                            val digits = supportWhatsapp.filter { it.isDigit() }
                            ContactRow(Icons.Filled.Phone, WhatsAppGreen, "WhatsApp: $supportWhatsapp") {
                                open("https://wa.me/$digits")
                            }
                        }
                        if (!supportEmail.isNullOrBlank()) {
                            ContactRow(Icons.Filled.Email, Purple, supportEmail) {
                                open("mailto:$supportEmail")
                            }
                        }
                    }
                }

                Spacer(Modifier.height(18.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Brush.horizontalGradient(listOf(Purple, Blue)))
                        .clickable(onClick = onRenew),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = ctaLabel,
                        fontFamily = PoppinsFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = Color.White
                    )
                }
                if (!blocking) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Later",
                        fontFamily = PoppinsFamily,
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier
                            .clickable(onClick = onLater)
                            .padding(6.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ContactRow(icon: ImageVector, badge: Color, label: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(vertical = 2.dp)
    ) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(badge),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(label, fontFamily = PoppinsFamily, fontSize = 15.sp, color = Color.White)
    }
}

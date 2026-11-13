package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import aivastra.nice.interactive.ui.theme.PoppinsFamily

/**
 * Shown when the app was reopened after Android reclaimed it while idle: the page being shown
 * is restored but the in-memory try-on data behind it is gone, so the page would be empty.
 * [onGoToDownloads] is null when no finished looks survived. Not dismissible by tapping outside.
 */
@Composable
fun SessionInterruptedDialog(
    onGoHome: () -> Unit,
    onGoToDownloads: (() -> Unit)?
) {
    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(0.85f)
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xFF1A1A1A))
                .padding(horizontal = 24.dp, vertical = 28.dp),
            contentAlignment = Alignment.TopCenter
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier
                        .size(58.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF1E1609))
                        .border(1.5.dp, Color(0xFFE7A52C).copy(alpha = 0.6f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = Color(0xFFE7A52C),
                        modifier = Modifier.size(26.dp)
                    )
                }

                Spacer(Modifier.height(16.dp))

                Text(
                    text = "Session timed out",
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = Color.White,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(10.dp))

                Text(
                    text = if (onGoToDownloads != null) {
                        "The app was idle for a while. Your finished looks are saved — go to Downloads to get them, or start over from Home."
                    } else {
                        "The app was idle for a while and this session ended. Start over from Home."
                    },
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(22.dp))

                if (onGoToDownloads != null) {
                    GradientButton(
                        onClick = onGoToDownloads,
                        width = 0.dp,
                        height = 46.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "Go to Downloads",
                            fontFamily = PoppinsFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = Color.White
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    ExitDialogSecondaryButton(text = "Go to Home", onClick = onGoHome)
                } else {
                    GradientButton(
                        onClick = onGoHome,
                        width = 0.dp,
                        height = 46.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "Go to Home",
                            fontFamily = PoppinsFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = Color.White
                        )
                    }
                }
            }
        }
    }
}

package aivastra.nice.interactive.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import kotlinx.coroutines.delay

/**
 * Toast display type.
 */
enum class ToastType { SUCCESS, ERROR, WARNING }

/**
 * Reusable in-app toast notification overlay.
 *
 * Place this inside a Box that fills the full screen at a high z-index.
 * Automatically dismisses after [autoDismissMs] milliseconds.
 *
 * @param visible       Whether the toast is currently visible.
 * @param message       The text message to display.
 * @param type          Visual style: SUCCESS (green), ERROR (red), WARNING (amber).
 * @param autoDismissMs Auto-dismiss delay in milliseconds. 0 = never auto-dismiss.
 * @param onDismiss     Called when the toast is dismissed (by timer or manually).
 */
@Composable
fun AppToast(
    visible: Boolean,
    message: String,
    type: ToastType = ToastType.SUCCESS,
    autoDismissMs: Long = 3000L,
    onDismiss: () -> Unit = {}
) {
    if (visible && autoDismissMs > 0L) {
        LaunchedEffect(message, visible) {
            delay(autoDismissMs)
            onDismiss()
        }
    }

    val (bgColor, iconTint, icon) = when (type) {
        ToastType.SUCCESS -> Triple(
            Color(0xFF1E3A1E),
            Color(0xFF4CAF50),
            Icons.Default.Check
        )
        ToastType.ERROR -> Triple(
            Color(0xFF3A1E1E),
            Color(0xFFE57373),
            Icons.Default.Close
        )
        ToastType.WARNING -> Triple(
            Color(0xFF2A2200),
            Color(0xFFF2B53F),
            Icons.Default.Warning
        )
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn() + slideInVertically(initialOffsetY = { -it }),
        exit = fadeOut() + slideOutVertically(targetOffsetY = { -it })
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = sdp(R.dimen._20sdp), vertical = sdp(R.dimen._12sdp))
                .clip(RoundedCornerShape(sdp(R.dimen._12sdp)))
                .background(bgColor)
                .padding(horizontal = sdp(R.dimen._16sdp), vertical = sdp(R.dimen._14sdp))
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(sdp(R.dimen._20sdp))
                )
                Spacer(modifier = Modifier.width(sdp(R.dimen._10sdp)))
                Text(
                    text = message,
                    fontFamily = PoppinsFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = ssp(R.dimen._13ssp),
                    color = Color.White
                )
            }
        }
    }
}

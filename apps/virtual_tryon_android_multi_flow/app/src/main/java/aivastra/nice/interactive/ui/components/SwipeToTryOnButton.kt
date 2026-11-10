package aivastra.nice.interactive.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Payment-app style "slide to confirm" button. A round thumb is dragged along the track;
 * waves of chevrons, a ripple around the thumb and a shimmer across the label invite the swipe.
 * Releasing past [CONFIRM_FRACTION] of the track fires [onConfirm].
 */
@Composable
fun SwipeToTryOnButton(
    label: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier
) {
    val trackShape = RoundedCornerShape(percent = 50)
    val thumbSize = sdp(R.dimen._action_button_height) - sdp(R.dimen._10sdp)
    val inset = sdp(R.dimen._5sdp)
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val dragX = remember { Animatable(0f) }
    var confirmed by remember { mutableStateOf(false) }

    val transition = rememberInfiniteTransition(label = "swipeWaves")
    val wave by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing)),
        label = "wave"
    )
    val ripple by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing)),
        label = "ripple"
    )
    val shimmer by transition.animateFloat(
        initialValue = -0.3f,
        targetValue = 1.3f,
        animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmer"
    )

    // Come back to the start once the screen has had time to react.
    LaunchedEffect(confirmed) {
        if (confirmed) {
            delay(900)
            dragX.animateTo(0f, spring(Spring.DampingRatioMediumBouncy))
            confirmed = false
        }
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(sdp(R.dimen._action_button_height))
            .clip(trackShape)
            .background(Brush.horizontalGradient(listOf(Color(0xFF3A2A12), Color(0xFF5A3A0E))))
    ) {
        val density = LocalDensity.current
        val thumbPx = with(density) { thumbSize.toPx() }
        val insetPx = with(density) { inset.toPx() }
        val maxDrag = with(density) { maxWidth.toPx() } - thumbPx - 2 * insetPx
        val progress = if (maxDrag > 0f) (dragX.value / maxDrag).coerceIn(0f, 1f) else 0f

        // Fill that trails the thumb.
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .width(with(density) { (dragX.value + thumbPx + 2 * insetPx).toDp() })
                .clip(trackShape)
                .background(Brush.horizontalGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
        )

        // Label with a light sweep running across it; fades out as the thumb covers it.
        Text(
            text = label,
            style = TextStyle(
                brush = Brush.horizontalGradient(
                    0f to Color.White.copy(alpha = 0.55f),
                    (shimmer - 0.15f).coerceIn(0f, 1f) to Color.White.copy(alpha = 0.55f),
                    shimmer.coerceIn(0f, 1f) to Color.White,
                    (shimmer + 0.15f).coerceIn(0f, 1f) to Color.White.copy(alpha = 0.55f),
                    1f to Color.White.copy(alpha = 0.55f)
                ),
                fontSize = ssp(R.dimen._14ssp),
                fontWeight = FontWeight.SemiBold,
                fontFamily = PoppinsFamily
            ),
            modifier = Modifier
                .align(Alignment.Center)
                .padding(start = thumbSize / 2)
                .graphicsAlpha(1f - progress)
        )

        // Chevron waves to the right of the thumb, lighting up one after another.
        Canvas(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = sdp(R.dimen._18sdp))
                .size(sdp(R.dimen._40sdp), sdp(R.dimen._18sdp))
        ) {
            val chev = size.height / 2f
            for (i in 0 until 3) {
                val t = ((wave - i * 0.18f) % 1f + 1f) % 1f
                val a = (sin(Math.PI * t).toFloat()).coerceIn(0f, 1f) * (1f - progress)
                val x = i * (size.width / 3f)
                val path = androidx.compose.ui.graphics.Path().apply {
                    moveTo(x, size.height / 2f - chev)
                    lineTo(x + chev, size.height / 2f)
                    lineTo(x, size.height / 2f + chev)
                }
                drawPath(
                    path,
                    Color.White.copy(alpha = 0.15f + 0.85f * a),
                    style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
                )
            }
        }

        // Thumb with an expanding ripple.
        Box(
            modifier = Modifier
                .offset { IntOffset((insetPx + dragX.value).roundToInt(), 0) }
                .align(Alignment.CenterStart)
                .size(thumbSize)
                .drawBehind {
                    val r = size.minDimension / 2f
                    for (k in 0..1) {
                        val t = ((ripple + k * 0.5f) % 1f)
                        drawCircle(
                            color = Color.White.copy(alpha = 0.45f * (1f - t) * (1f - progress)),
                            radius = r + r * 0.9f * t,
                            center = Offset(size.width / 2f, size.height / 2f)
                        )
                    }
                }
                .clip(CircleShape)
                .background(Color.White)
                .pointerInput(maxDrag) {
                    detectHorizontalDragGestures(
                        onDragStart = { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove) },
                        onHorizontalDrag = { change, delta ->
                            if (confirmed) return@detectHorizontalDragGestures
                            change.consume()
                            scope.launch { dragX.snapTo((dragX.value + delta).coerceIn(0f, maxDrag)) }
                        },
                        onDragEnd = {
                            if (confirmed) return@detectHorizontalDragGestures
                            scope.launch {
                                if (dragX.value >= maxDrag * CONFIRM_FRACTION) {
                                    confirmed = true
                                    dragX.animateTo(maxDrag, tween(120))
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onConfirm()
                                } else {
                                    dragX.animateTo(0f, spring(Spring.DampingRatioMediumBouncy))
                                }
                            }
                        },
                        onDragCancel = {
                            if (!confirmed) scope.launch { dragX.animateTo(0f, spring()) }
                        }
                    )
                },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "Swipe to try on",
                tint = Color(0xFF9B5100),
                modifier = Modifier.size(thumbSize / 2)
            )
        }
    }
}

private const val CONFIRM_FRACTION = 0.85f

private fun Modifier.graphicsAlpha(alpha: Float): Modifier =
    this.then(Modifier.graphicsLayer { this.alpha = alpha })

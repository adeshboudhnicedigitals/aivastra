package aivastra.nice.interactive.camera

import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val PanelBg = Color(0xF21B1E24)
private val Accent = Color(0xFFE7A52C)
private val Muted = Color(0xFF9EA6B8)

// Bottom panel opened by long-pressing a filter (Original included). Edits are reported through
// [onChange] one slider at a time; the host owns persistence. Swallows taps/drags on its own
// surface so they never reach the shutter button underneath.
@Composable
fun FilterAdjustPanel(
    filter: CameraFilterOption,
    adjustments: FilterAdjustments,
    onChange: (FilterAdjustments) -> Unit,
    onReset: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = sdp(R.dimen._24sdp), topEnd = sdp(R.dimen._24sdp)))
            .background(PanelBg)
            .pointerInput(Unit) { detectTapGestures { } }
            .padding(horizontal = sdp(R.dimen._20sdp), vertical = sdp(R.dimen._12sdp))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${filter.label} · Adjust",
                color = Color.White,
                fontSize = ssp(R.dimen._15ssp),
                fontWeight = FontWeight.Bold,
                fontFamily = PoppinsFamily,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = "Reset",
                color = if (adjustments.isNeutral) Muted else Accent,
                fontSize = ssp(R.dimen._13ssp),
                fontWeight = FontWeight.Bold,
                fontFamily = PoppinsFamily,
                modifier = Modifier
                    .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
                    .clickable(enabled = !adjustments.isNeutral, onClick = onReset)
                    .padding(horizontal = sdp(R.dimen._10sdp), vertical = sdp(R.dimen._4sdp))
            )
            Text(
                text = "Done",
                color = Accent,
                fontSize = ssp(R.dimen._13ssp),
                fontWeight = FontWeight.Bold,
                fontFamily = PoppinsFamily,
                modifier = Modifier
                    .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
                    .clickable(onClick = onDone)
                    .padding(horizontal = sdp(R.dimen._10sdp), vertical = sdp(R.dimen._4sdp))
            )
        }

        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
        ) {
            if (!filter.isOriginal) {
                SectionTitle("Look")
                StrengthSlider(adjustments.strength) { onChange(adjustments.copy(strength = it)) }
            }

            SectionTitle("Light")
            AdjustRow("Brightness", adjustments.brightness) { onChange(adjustments.copy(brightness = it)) }
            AdjustRow("Exposure", adjustments.exposure) { onChange(adjustments.copy(exposure = it)) }
            AdjustRow("Contrast", adjustments.contrast) { onChange(adjustments.copy(contrast = it)) }
            AdjustRow("Highlights", adjustments.highlights) { onChange(adjustments.copy(highlights = it)) }
            AdjustRow("Shadows", adjustments.shadows) { onChange(adjustments.copy(shadows = it)) }
            AdjustRow("Vignette", adjustments.vignette) { onChange(adjustments.copy(vignette = it)) }

            SectionTitle("Colour")
            AdjustRow("Saturation", adjustments.saturation) { onChange(adjustments.copy(saturation = it)) }
            AdjustRow("Warmth", adjustments.warmth) { onChange(adjustments.copy(warmth = it)) }
            AdjustRow("Tint", adjustments.tint) { onChange(adjustments.copy(tint = it)) }
            AdjustRow("Sharpness", adjustments.sharpness) { onChange(adjustments.copy(sharpness = it)) }
            Text(
                text = "Sharpness shows on the saved photo, not the live preview. Double-tap a slider to reset it.",
                color = Muted,
                fontSize = ssp(R.dimen._9ssp),
                fontFamily = PoppinsFamily,
                modifier = Modifier.padding(top = sdp(R.dimen._8sdp), bottom = sdp(R.dimen._8sdp))
            )
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        color = Color.White,
        fontSize = ssp(R.dimen._14ssp),
        fontWeight = FontWeight.Bold,
        fontFamily = PoppinsFamily,
        modifier = Modifier.padding(top = sdp(R.dimen._12sdp), bottom = sdp(R.dimen._4sdp))
    )
}

@Composable
private fun AdjustRow(label: String, value: Int, onValueChange: (Int) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = sdp(R.dimen._4sdp))) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = Color.White, fontSize = ssp(R.dimen._12ssp), fontFamily = PoppinsFamily)
            Text(
                text = value.toString(),
                color = if (value == 0) Muted else Accent,
                fontSize = ssp(R.dimen._12ssp),
                fontFamily = PoppinsFamily
            )
        }
        CenterSlider(value = value, min = -100, max = 100, onValueChange = onValueChange)
    }
}

@Composable
private fun StrengthSlider(value: Int, onValueChange: (Int) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = sdp(R.dimen._4sdp))) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Strength", color = Color.White, fontSize = ssp(R.dimen._12ssp), fontFamily = PoppinsFamily)
            Text(
                text = "$value%",
                color = if (value == FilterAdjustments.DEFAULT_STRENGTH) Muted else Accent,
                fontSize = ssp(R.dimen._12ssp),
                fontFamily = PoppinsFamily
            )
        }
        // Origin sits at 100% (the look as designed), so the fill grows from there either way.
        CenterSlider(
            value = value,
            min = 0,
            max = FilterAdjustments.MAX_STRENGTH,
            origin = FilterAdjustments.DEFAULT_STRENGTH,
            onValueChange = onValueChange
        )
    }
}

// Track whose highlighted segment runs from [origin] to the thumb, like the reference design.
// Tap or drag to set; double-tap snaps back to [origin].
@Composable
private fun CenterSlider(
    value: Int,
    min: Int,
    max: Int,
    origin: Int = 0,
    onValueChange: (Int) -> Unit
) {
    val latest = rememberUpdatedState(onValueChange)
    val span = (max - min).toFloat()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(sdp(R.dimen._24sdp))
            .pointerInput(min, max, origin) {
                detectTapGestures(
                    onDoubleTap = { latest.value(origin) },
                    onTap = { pos ->
                        latest.value((min + (pos.x / size.width).coerceIn(0f, 1f) * span).toInt())
                    }
                )
            }
            .pointerInput(min, max) {
                detectHorizontalDragGestures { change, _ ->
                    change.consume()
                    latest.value((min + (change.position.x / size.width).coerceIn(0f, 1f) * span).toInt())
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxWidth().height(sdp(R.dimen._24sdp))) {
            val thumbR = 9.dp.toPx()
            val trackW = 3.dp.toPx()
            val left = thumbR
            val right = size.width - thumbR
            val cy = size.height / 2f
            fun xOf(v: Int) = left + (v - min) / span * (right - left)

            drawLine(Color.White.copy(alpha = 0.25f), Offset(left, cy), Offset(right, cy), trackW, StrokeCap.Round)
            drawLine(Accent, Offset(xOf(origin), cy), Offset(xOf(value), cy), trackW * 1.6f, StrokeCap.Round)
            drawCircle(Color.White.copy(alpha = 0.2f), thumbR + 3.dp.toPx(), Offset(xOf(value), cy))
            drawCircle(Accent, thumbR, Offset(xOf(value), cy))
        }
    }
}

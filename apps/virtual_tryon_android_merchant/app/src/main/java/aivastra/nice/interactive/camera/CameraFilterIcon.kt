package aivastra.nice.interactive.camera

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// Line icons for the camera filter chips, drawn on a Canvas in a 0..1 unit square. The project has
// no extended Material icon set (and adding one is a large dependency for 16 glyphs), so each
// filter gets its own small hand-built shape instead.
@Composable
fun CameraFilterIcon(option: CameraFilterOption, tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val side = size.minDimension
        // Everything below is expressed in unit coordinates, so the stroke width is too.
        scale(side, side, pivot = Offset.Zero) { drawFilterShape(option, tint) }
    }
}

private const val STROKE = 0.085f

private fun DrawScope.drawFilterShape(option: CameraFilterOption, c: Color) {
    val line = Stroke(width = STROKE, cap = StrokeCap.Round, join = StrokeJoin.Round)

    fun ray(angleDeg: Float, from: Float, to: Float, cx: Float = 0.5f, cy: Float = 0.5f) {
        val a = angleDeg * PI.toFloat() / 180f
        drawLine(
            c,
            Offset(cx + cos(a) * from, cy + sin(a) * from),
            Offset(cx + cos(a) * to, cy + sin(a) * to),
            strokeWidth = STROKE,
            cap = StrokeCap.Round
        )
    }

    fun outline(build: Path.() -> Unit, style: androidx.compose.ui.graphics.drawscope.DrawStyle = line) {
        drawPath(Path().apply(build).apply { close() }, c, style = style)
    }

    when (option) {
        CameraFilterOption.ORIGINAL -> drawCircle(c, radius = 0.36f, center = Offset(0.5f, 0.5f), style = line)

        CameraFilterOption.NATURAL -> {
            outline({
                moveTo(0.2f, 0.8f)
                cubicTo(0.1f, 0.3f, 0.5f, 0.1f, 0.85f, 0.15f)
                cubicTo(0.9f, 0.55f, 0.6f, 0.9f, 0.2f, 0.8f)
            })
            drawLine(c, Offset(0.2f, 0.8f), Offset(0.55f, 0.45f), strokeWidth = STROKE, cap = StrokeCap.Round)
        }

        CameraFilterOption.SOFT -> {
            drawCircle(c, 0.16f, Offset(0.33f, 0.58f), style = Fill)
            drawCircle(c, 0.2f, Offset(0.52f, 0.45f), style = Fill)
            drawCircle(c, 0.15f, Offset(0.7f, 0.6f), style = Fill)
            drawRoundRect(c, Offset(0.2f, 0.58f), Size(0.6f, 0.2f), CornerRadius(0.1f), style = Fill)
        }

        CameraFilterOption.FRESH -> outline({
            moveTo(0.5f, 0.12f)
            cubicTo(0.5f, 0.12f, 0.2f, 0.48f, 0.2f, 0.64f)
            cubicTo(0.2f, 0.82f, 0.34f, 0.9f, 0.5f, 0.9f)
            cubicTo(0.66f, 0.9f, 0.8f, 0.82f, 0.8f, 0.64f)
            cubicTo(0.8f, 0.48f, 0.5f, 0.12f, 0.5f, 0.12f)
        })

        CameraFilterOption.BRIGHT -> {
            drawCircle(c, 0.17f, Offset(0.5f, 0.5f), style = line)
            for (i in 0 until 8) ray(i * 45f, 0.28f, 0.4f)
        }

        CameraFilterOption.BEAUTY -> {
            outline({
                moveTo(0.46f, 0.12f)
                quadraticTo(0.5f, 0.45f, 0.84f, 0.5f)
                quadraticTo(0.5f, 0.55f, 0.46f, 0.88f)
                quadraticTo(0.42f, 0.55f, 0.08f, 0.5f)
                quadraticTo(0.42f, 0.45f, 0.46f, 0.12f)
            }, Fill)
            drawCircle(c, 0.05f, Offset(0.82f, 0.2f), style = Fill)
        }

        CameraFilterOption.CLASSIC -> {
            drawRoundRect(c, Offset(0.15f, 0.2f), Size(0.7f, 0.6f), CornerRadius(0.07f), style = line)
            drawLine(c, Offset(0.33f, 0.2f), Offset(0.33f, 0.8f), strokeWidth = STROKE, cap = StrokeCap.Round)
            drawLine(c, Offset(0.67f, 0.2f), Offset(0.67f, 0.8f), strokeWidth = STROKE, cap = StrokeCap.Round)
        }

        CameraFilterOption.PASTEL -> {
            for (i in 0 until 5) {
                val a = (i * 72f - 90f) * PI.toFloat() / 180f
                drawCircle(c, 0.13f, Offset(0.5f + cos(a) * 0.24f, 0.5f + sin(a) * 0.24f), style = line)
            }
            drawCircle(c, 0.07f, Offset(0.5f, 0.5f), style = Fill)
        }

        CameraFilterOption.GLOW -> {
            drawCircle(c, 0.13f, Offset(0.5f, 0.5f), style = Fill)
            drawCircle(c.copy(alpha = 0.65f), 0.26f, Offset(0.5f, 0.5f), style = line)
            drawCircle(c.copy(alpha = 0.35f), 0.39f, Offset(0.5f, 0.5f), style = line)
        }

        CameraFilterOption.ROSE -> outline({
            moveTo(0.5f, 0.85f)
            cubicTo(0.1f, 0.55f, 0.15f, 0.2f, 0.35f, 0.2f)
            cubicTo(0.45f, 0.2f, 0.5f, 0.3f, 0.5f, 0.33f)
            cubicTo(0.5f, 0.3f, 0.55f, 0.2f, 0.65f, 0.2f)
            cubicTo(0.85f, 0.2f, 0.9f, 0.55f, 0.5f, 0.85f)
        })

        CameraFilterOption.GOLDEN -> {
            drawArc(c, 180f, 180f, false, Offset(0.28f, 0.4f), Size(0.44f, 0.44f), style = line)
            drawLine(c, Offset(0.12f, 0.62f), Offset(0.88f, 0.62f), strokeWidth = STROKE, cap = StrokeCap.Round)
            drawLine(c, Offset(0.3f, 0.8f), Offset(0.7f, 0.8f), strokeWidth = STROKE, cap = StrokeCap.Round)
            ray(-90f, 0.3f, 0.42f, cy = 0.62f)
            ray(-45f, 0.3f, 0.4f, cy = 0.62f)
            ray(-135f, 0.3f, 0.4f, cy = 0.62f)
        }

        CameraFilterOption.WARM -> outline({
            moveTo(0.5f, 0.1f)
            cubicTo(0.5f, 0.1f, 0.78f, 0.4f, 0.78f, 0.62f)
            cubicTo(0.78f, 0.78f, 0.65f, 0.9f, 0.5f, 0.9f)
            cubicTo(0.35f, 0.9f, 0.22f, 0.78f, 0.22f, 0.62f)
            cubicTo(0.22f, 0.45f, 0.4f, 0.35f, 0.5f, 0.1f)
        })

        CameraFilterOption.COOL -> {
            // Snowflake: three diameters.
            for (i in 0 until 3) {
                ray(i * 60f, 0f, 0.38f)
                ray(i * 60f + 180f, 0f, 0.38f)
            }
        }

        CameraFilterOption.ICE -> {
            // Hexagonal cube: outline plus three edges meeting at the centre.
            outline({
                for (i in 0 until 6) {
                    val a = (30f + i * 60f) * PI.toFloat() / 180f
                    val p = Offset(0.5f + cos(a) * 0.4f, 0.5f + sin(a) * 0.4f)
                    if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
                }
            })
            ray(90f, 0f, 0.4f)
            ray(210f, 0f, 0.4f)
            ray(330f, 0f, 0.4f)
        }

        CameraFilterOption.MINT -> {
            for (dy in listOf(0f, 0.25f)) {
                drawPath(
                    Path().apply {
                        moveTo(0.1f, 0.33f + dy)
                        cubicTo(0.25f, 0.13f + dy, 0.35f, 0.53f + dy, 0.5f, 0.33f + dy)
                        cubicTo(0.65f, 0.13f + dy, 0.75f, 0.53f + dy, 0.9f, 0.33f + dy)
                    },
                    c, style = line
                )
            }
        }

        CameraFilterOption.CRISP -> {
            outline({
                moveTo(0.27f, 0.2f)
                lineTo(0.73f, 0.2f)
                lineTo(0.9f, 0.4f)
                lineTo(0.5f, 0.85f)
                lineTo(0.1f, 0.4f)
            })
            drawLine(c, Offset(0.1f, 0.4f), Offset(0.9f, 0.4f), strokeWidth = STROKE, cap = StrokeCap.Round)
        }

        CameraFilterOption.PEACH -> {
            drawCircle(c, 0.3f, Offset(0.5f, 0.58f), style = line)
            outline({
                moveTo(0.5f, 0.28f)
                quadraticTo(0.55f, 0.12f, 0.74f, 0.14f)
                quadraticTo(0.72f, 0.3f, 0.5f, 0.28f)
            })
        }

        CameraFilterOption.LAVENDER -> outline({
            moveTo(0.5f, 0.1f)
            lineTo(0.85f, 0.5f)
            lineTo(0.5f, 0.9f)
            lineTo(0.15f, 0.5f)
        })

        CameraFilterOption.FOREST -> {
            outline({
                moveTo(0.5f, 0.1f)
                lineTo(0.78f, 0.5f)
                lineTo(0.22f, 0.5f)
            })
            outline({
                moveTo(0.5f, 0.35f)
                lineTo(0.86f, 0.75f)
                lineTo(0.14f, 0.75f)
            })
            drawLine(c, Offset(0.5f, 0.75f), Offset(0.5f, 0.92f), strokeWidth = STROKE, cap = StrokeCap.Round)
        }

        CameraFilterOption.MOODY ->
            // Open arc reads as a crescent moon.
            drawArc(c, 60f, 240f, false, Offset(0.15f, 0.15f), Size(0.7f, 0.7f), style = line)

        CameraFilterOption.VIVID -> outline({
            moveTo(0.5f, 0.08f)
            quadraticTo(0.54f, 0.46f, 0.92f, 0.5f)
            quadraticTo(0.54f, 0.54f, 0.5f, 0.92f)
            quadraticTo(0.46f, 0.54f, 0.08f, 0.5f)
            quadraticTo(0.46f, 0.46f, 0.5f, 0.08f)
        })

        CameraFilterOption.MATTE -> {
            drawRoundRect(c, Offset(0.15f, 0.15f), Size(0.7f, 0.7f), CornerRadius(0.1f), style = line)
            drawLine(c, Offset(0.15f, 0.5f), Offset(0.85f, 0.5f), strokeWidth = STROKE, cap = StrokeCap.Round)
        }
    }
}

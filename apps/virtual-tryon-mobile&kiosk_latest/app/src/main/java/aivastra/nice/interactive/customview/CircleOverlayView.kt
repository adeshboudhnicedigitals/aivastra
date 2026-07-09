package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.util.AttributeSet
import android.view.View

class CircleOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private val paint = Paint().apply {
        color = Color.parseColor("#50d3a571") // semi-transparent overlay
        style = Paint.Style.FILL
        isAntiAlias = true
    }

    private val clearPaint = Paint().apply {
        color = Color.TRANSPARENT
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        isAntiAlias = true
    }

    private val cornerPaint = Paint().apply {
        color = Color.WHITE
        strokeWidth = 8f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    private var showCorners = false

    fun showCorners(show: Boolean) {
        showCorners = show
        invalidate() // redraw
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        // Draw overlay
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)

        // Draw transparent circle in center
        val radius = 300f
        val cx = width / 2f
        val cy = height / 4f // adjust vertical position
        canvas.drawCircle(cx, cy, radius, clearPaint)

        // Draw corners if enabled
        if (showCorners) {
            val cornerLength = 60f
            // Top-left corner
            canvas.drawLine(cx - radius, cy - radius, cx - radius + cornerLength, cy - radius, cornerPaint)
            canvas.drawLine(cx - radius, cy - radius, cx - radius, cy - radius + cornerLength, cornerPaint)

            // Top-right corner
            canvas.drawLine(cx + radius, cy - radius, cx + radius - cornerLength, cy - radius, cornerPaint)
            canvas.drawLine(cx + radius, cy - radius, cx + radius, cy - radius + cornerLength, cornerPaint)

            // Bottom-left corner
            canvas.drawLine(cx - radius, cy + radius, cx - radius + cornerLength, cy + radius, cornerPaint)
            canvas.drawLine(cx - radius, cy + radius, cx - radius, cy + radius - cornerLength, cornerPaint)

            // Bottom-right corner
            canvas.drawLine(cx + radius, cy + radius, cx + radius - cornerLength, cy + radius, cornerPaint)
            canvas.drawLine(cx + radius, cy + radius, cx + radius, cy + radius - cornerLength, cornerPaint)
        }
    }
}

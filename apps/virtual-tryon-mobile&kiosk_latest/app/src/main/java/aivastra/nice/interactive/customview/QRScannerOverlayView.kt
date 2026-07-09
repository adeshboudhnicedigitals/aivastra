package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.util.AttributeSet
import android.view.View

class QRScannerOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    // Overlay paint
    private val overlayPaint = Paint().apply {
        color = Color.parseColor("#80000000") // semi-transparent black
        style = Paint.Style.FILL
        isAntiAlias = true
    }

    // Transparent cutout paint
    private val clearPaint = Paint().apply {
        color = Color.TRANSPARENT
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        isAntiAlias = true
    }

    // Corner paint
    private val cornerPaint = Paint().apply {
        color = Color.WHITE
        strokeWidth = 8f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    // Scan line paint
    private val scanLinePaint = Paint().apply {
        color = Color.RED
        strokeWidth = 5f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    // Configurable properties
    var showCorners = true
        set(value) {
            field = value
            invalidate()
        }

    var showScanLine = true
        set(value) {
            field = value
            invalidate()
        }

    var useCircle = false
        set(value) {
            field = value
            invalidate()
        }

    private var scanY = 0f
    private var scanDirection = 1

    // Scanning area size
    private val radius = 300f // circle radius
    private val rectWidth = 600f
    private val rectHeight = 600f

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f // center

        // Draw overlay
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), overlayPaint)

        if (useCircle) {
            // Draw transparent circle
            canvas.drawCircle(cx, cy, radius, clearPaint)
        } else {
            // Draw transparent rectangle
            val left = cx - rectWidth / 2
            val top = cy - rectHeight / 2
            val right = cx + rectWidth / 2
            val bottom = cy + rectHeight / 2
            canvas.drawRect(left, top, right, bottom, clearPaint)
        }

        // Draw corners if enabled
        if (showCorners) drawCorners(canvas, cx, cy)

        // Draw scanning line if enabled
        if (showScanLine) drawScanLine(canvas, cx, cy)

        // Animate
        postInvalidateOnAnimation()
    }

    private fun drawCorners(canvas: Canvas, cx: Float, cy: Float) {
        val cornerLength = 60f
        if (useCircle) {
            // Draw for circle
            val r = radius
            // Top-left
            canvas.drawLine(cx - r, cy - r, cx - r + cornerLength, cy - r, cornerPaint)
            canvas.drawLine(cx - r, cy - r, cx - r, cy - r + cornerLength, cornerPaint)
            // Top-right
            canvas.drawLine(cx + r, cy - r, cx + r - cornerLength, cy - r, cornerPaint)
            canvas.drawLine(cx + r, cy - r, cx + r, cy - r + cornerLength, cornerPaint)
            // Bottom-left
            canvas.drawLine(cx - r, cy + r, cx - r + cornerLength, cy + r, cornerPaint)
            canvas.drawLine(cx - r, cy + r, cx - r, cy + r - cornerLength, cornerPaint)
            // Bottom-right
            canvas.drawLine(cx + r, cy + r, cx + r - cornerLength, cy + r, cornerPaint)
            canvas.drawLine(cx + r, cy + r, cx + r, cy + r - cornerLength, cornerPaint)
        } else {
            // Draw for rectangle
            val left = cx - rectWidth / 2
            val top = cy - rectHeight / 2
            val right = cx + rectWidth / 2
            val bottom = cy + rectHeight / 2
            // Top-left
            canvas.drawLine(left, top, left + cornerLength, top, cornerPaint)
            canvas.drawLine(left, top, left, top + cornerLength, cornerPaint)
            // Top-right
            canvas.drawLine(right, top, right - cornerLength, top, cornerPaint)
            canvas.drawLine(right, top, right, top + cornerLength, cornerPaint)
            // Bottom-left
            canvas.drawLine(left, bottom, left + cornerLength, bottom, cornerPaint)
            canvas.drawLine(left, bottom, left, bottom - cornerLength, cornerPaint)
            // Bottom-right
            canvas.drawLine(right, bottom, right - cornerLength, bottom, cornerPaint)
            canvas.drawLine(right, bottom, right, bottom - cornerLength, cornerPaint)
        }
    }

    private fun drawScanLine(canvas: Canvas, cx: Float, cy: Float) {
        if (useCircle) {
            if (scanY == 0f) scanY = cy - radius
            canvas.drawLine(cx - radius, scanY, cx + radius, scanY, scanLinePaint)
            scanY += scanDirection * 8
            if (scanY > cy + radius) scanDirection = -1
            if (scanY < cy - radius) scanDirection = 1
        } else {
            if (scanY == 0f) scanY = cy - rectHeight / 2
            val left = cx - rectWidth / 2
            val right = cx + rectWidth / 2
            val top = cy - rectHeight / 2
            val bottom = cy + rectHeight / 2
            canvas.drawLine(left, scanY, right, scanY, scanLinePaint)
            scanY += scanDirection * 8
            if (scanY > bottom) scanDirection = -1
            if (scanY < top) scanDirection = 1
        }
    }
}

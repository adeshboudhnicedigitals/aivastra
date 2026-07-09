package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatTextView

class StrokeTextView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : AppCompatTextView(context, attrs, defStyleAttr) {

    private val strokePaint = Paint()
    private val fillPaint = Paint()

    init {
        strokePaint.isAntiAlias = true
        strokePaint.style = Paint.Style.STROKE
        strokePaint.strokeWidth = 8f  // outline thickness
        strokePaint.color = Color.WHITE  // outline color
        strokePaint.textAlign = Paint.Align.LEFT
        strokePaint.setShadowLayer(10f, 6f, 6f, Color.argb(160, 0, 0, 0)) // shadow

        fillPaint.isAntiAlias = true
        fillPaint.style = Paint.Style.FILL
        fillPaint.color = Color.WHITE  // main fill color
        fillPaint.textAlign = Paint.Align.LEFT
    }

    override fun onDraw(canvas: Canvas) {
        val text = text.toString()
        val x = (width - paint.measureText(text)) / 2f
        val y = (height - paint.descent() - paint.ascent()) / 2f

        // Draw outline first
        strokePaint.textSize = textSize
        strokePaint.typeface = typeface
        canvas.drawText(text, x, y, strokePaint)

        // Draw fill text on top
        fillPaint.textSize = textSize
        fillPaint.typeface = typeface
        canvas.drawText(text, x, y, fillPaint)
    }
}
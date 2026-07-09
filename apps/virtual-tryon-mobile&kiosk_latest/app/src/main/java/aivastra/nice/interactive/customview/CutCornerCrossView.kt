package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View

class CutCornerCrossView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private val paint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 8f
        style = Paint.Style.STROKE
        isAntiAlias = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val w = width.toFloat()
        val h = height.toFloat()
        val cut = 40f // size of the cut corner

        // Draw square with 2 corners cut (top-left & bottom-right)
        val path = Path()
        path.moveTo(cut, 0f)          // start after top-left cut
        path.lineTo(w, 0f)             // top edge
        path.lineTo(w, h - cut)        // right edge before bottom-right cut
        path.lineTo(w - cut, h)        // bottom-right cut
        path.lineTo(0f, h)             // bottom-left
        path.lineTo(0f, cut)           // left edge before top-left cut
        path.close()

        canvas.drawPath(path, paint)

        // Draw cross lines inside
        canvas.drawLine(0f, 0f, w, h, paint)
        canvas.drawLine(w, 0f, 0f, h, paint)
    }
}
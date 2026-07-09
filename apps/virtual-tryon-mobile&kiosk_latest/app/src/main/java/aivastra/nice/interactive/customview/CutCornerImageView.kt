package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatImageView


class CutCornerImageView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : AppCompatImageView(context, attrs) {

    private val path = Path()
    private val rect = RectF()

    // how deep the corner cut is
    private val cutSize = 40f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        rect.set(0f, 0f, w.toFloat(), h.toFloat())
        buildPath()
    }

    private fun buildPath() {
        path.reset()
        // Start at top edge after cutting top-left
        path.moveTo(cutSize, 0f)
        path.lineTo(rect.right, 0f)                             // top edge
        path.lineTo(rect.right, rect.bottom - cutSize)          // right edge down
        path.lineTo(rect.right - cutSize, rect.bottom)          // diagonal cut bottom-right
        path.lineTo(0f, rect.bottom)                            // bottom edge
        path.lineTo(0f, cutSize)                                // left edge up
        path.close()
    }

    override fun onDraw(canvas: Canvas) {
        canvas.save()
        canvas.clipPath(path)
        super.onDraw(canvas)
        canvas.restore()
    }
}
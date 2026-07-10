package aivastra.nice.interactive.customview

import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import com.google.android.material.button.MaterialButton

object ButtonAnimationHelper {

    // Apply to a single button
     fun applyPressAnimation(button: MaterialButton) {
        button.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    v.animate().scaleX(0.95f).scaleY(0.95f).setDuration(100).start()
                }
                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(100).start()
                }
            }
            false  // allows normal click to still work
        }
    }

    // Recursively apply to all MaterialButtons inside a ViewGroup
    fun applyToAllButtons(root: View) {
        if (root is MaterialButton) {
            applyPressAnimation(root)
        } else if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                val child = root.getChildAt(i)
                applyToAllButtons(child)
            }
        }
    }
}
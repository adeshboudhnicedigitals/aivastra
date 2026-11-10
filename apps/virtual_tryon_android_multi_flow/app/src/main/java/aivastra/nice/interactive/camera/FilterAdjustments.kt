package aivastra.nice.interactive.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.ColorMatrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import kotlin.math.hypot
import kotlin.math.pow

// Manual tuning layered on top of a filter look. Every slider runs -100..100 with 0 = untouched,
// so a fresh install (all zeros) behaves exactly as before. [strength] is the old look-intensity
// bar, kept as the first slider; 100 = the look as designed.
data class FilterAdjustments(
    val strength: Int = DEFAULT_STRENGTH,
    val brightness: Int = 0,
    val exposure: Int = 0,
    val contrast: Int = 0,
    val highlights: Int = 0,
    val shadows: Int = 0,
    val vignette: Int = 0,
    val saturation: Int = 0,
    val warmth: Int = 0,
    val tint: Int = 0,
    val sharpness: Int = 0
) {
    val isNeutral: Boolean get() = this == FilterAdjustments()

    // True when nothing beyond the colour matrix is needed, so the preview can skip the vignette
    // overlay and the capture can skip the sharpen pass.
    val hasVignette: Boolean get() = vignette != 0
    val hasSharpness: Boolean get() = sharpness != 0

    val strengthFraction: Float get() = strength / 100f

    companion object {
        const val DEFAULT_STRENGTH = 100
        const val MAX_STRENGTH = 150
    }
}

// Same colour result for the live preview and the saved photo: both feed this matrix to a Paint
// colour filter, so what the customer sees is what gets uploaded. Highlights/shadows are linear
// approximations (a pivoted slope each) because a real tone curve can't run through a ColorMatrix,
// which is the only thing a TextureView layer paint can apply.
fun FilterAdjustments.toAdjustmentMatrix(): ColorMatrix {
    val m = ColorMatrix()
    if (this == FilterAdjustments(strength = strength)) return m

    fun affine(r: Float, g: Float, b: Float, offset: Float = 0f): ColorMatrix = ColorMatrix(
        floatArrayOf(
            r, 0f, 0f, 0f, offset,
            0f, g, 0f, 0f, offset,
            0f, 0f, b, 0f, offset,
            0f, 0f, 0f, 1f, 0f
        )
    )

    // Slope s around a pivot p on the 0..255 scale: out = p + s * (in - p).
    fun pivoted(slope: Float, pivot: Float) = affine(slope, slope, slope, pivot * (1f - slope))

    if (saturation != 0) {
        m.postConcat(ColorMatrix().apply { setSaturation(1f + saturation / 100f) })
    }
    if (exposure != 0) {
        val gain = 2f.pow(exposure / 100f)
        m.postConcat(affine(gain, gain, gain))
    }
    if (warmth != 0 || tint != 0) {
        val w = warmth / 100f
        val t = tint / 100f
        // Warmth pushes red up / blue down; positive tint is magenta (less green).
        m.postConcat(affine((1f + 0.2f * w) * (1f + 0.05f * t), 1f - 0.15f * t, (1f - 0.2f * w) * (1f + 0.05f * t)))
    }
    if (contrast != 0) m.postConcat(pivoted(1f + 0.6f * contrast / 100f, 128f))
    // Highlights act around the dark end so bright tones move most; shadows mirror that.
    if (highlights != 0) m.postConcat(pivoted(1f + 0.2f * highlights / 100f, 64f))
    if (shadows != 0) m.postConcat(pivoted(1f - 0.2f * shadows / 100f, 192f))
    if (brightness != 0) m.postConcat(affine(1f, 1f, 1f, brightness / 100f * 60f))
    return m
}

// The full colour transform for one filter + its adjustments. [enhance] is the capture-only lift.
fun colorMatrixFor(filter: CameraFilterOption, adjustments: FilterAdjustments, enhance: Boolean = false): ColorMatrix {
    val matrix = filter.toColorMatrix(adjustments.strengthFraction, enhance)
    matrix.postConcat(adjustments.toAdjustmentMatrix())
    return matrix
}

// Vignette as a radial gradient, shared by the preview overlay and the saved photo. Positive
// darkens the edges, negative lightens them.
internal fun vignetteColorArgb(vignette: Int): Int {
    val alpha = (kotlin.math.abs(vignette) / 100f * 0.75f * 255f).toInt().coerceIn(0, 255)
    val base = if (vignette > 0) 0x000000 else 0xFFFFFF
    return (alpha shl 24) or base
}

internal const val VIGNETTE_INNER_STOP = 0.5f

fun applyVignette(bitmap: Bitmap, vignette: Int) {
    if (vignette == 0) return
    val w = bitmap.width.toFloat()
    val h = bitmap.height.toFloat()
    val edge = vignetteColorArgb(vignette)
    val clear = edge and 0x00FFFFFF
    val paint = Paint().apply {
        shader = RadialGradient(
            w / 2f, h / 2f, hypot(w, h) / 2f,
            intArrayOf(clear, clear, edge),
            floatArrayOf(0f, VIGNETTE_INNER_STOP, 1f),
            Shader.TileMode.CLAMP
        )
    }
    AndroidCanvas(bitmap).drawRect(0f, 0f, w, h, paint)
}

// Unsharp mask against a 3x3 box blur, run in horizontal strips so a full-size capture is never
// held as a second int[] (an 8MP frame would be 32MB). Negative [sharpness] softens instead.
// Preview can't show this (a layer paint has no convolution), so it only affects the saved photo.
fun applySharpness(source: Bitmap, sharpness: Int): Bitmap {
    if (sharpness == 0) return source
    val w = source.width
    val h = source.height
    val amount = sharpness / 100f * 1.5f
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val strip = 128
    val src = IntArray(w * (strip + 2))
    val dst = IntArray(w * strip)

    var y0 = 0
    while (y0 < h) {
        val rows = minOf(strip, h - y0)
        val readTop = maxOf(0, y0 - 1)
        val readBottom = minOf(h, y0 + rows + 1)
        val readRows = readBottom - readTop
        source.getPixels(src, 0, w, 0, readTop, w, readRows)

        for (row in 0 until rows) {
            val y = y0 + row
            val sy = y - readTop
            for (x in 0 until w) {
                val centre = src[sy * w + x]
                var sr = 0; var sg = 0; var sb = 0; var n = 0
                for (dy in -1..1) {
                    val yy = sy + dy
                    if (yy < 0 || yy >= readRows) continue
                    for (dx in -1..1) {
                        val xx = x + dx
                        if (xx < 0 || xx >= w) continue
                        val p = src[yy * w + xx]
                        sr += (p shr 16) and 0xFF; sg += (p shr 8) and 0xFF; sb += p and 0xFF
                        n++
                    }
                }
                val cr = (centre shr 16) and 0xFF
                val cg = (centre shr 8) and 0xFF
                val cb = centre and 0xFF
                val r = (cr + amount * (cr - sr / n)).toInt().coerceIn(0, 255)
                val g = (cg + amount * (cg - sg / n)).toInt().coerceIn(0, 255)
                val b = (cb + amount * (cb - sb / n)).toInt().coerceIn(0, 255)
                dst[row * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        out.setPixels(dst, 0, w, 0, y0, w, rows)
        y0 += rows
    }
    source.recycle()
    return out
}

// Per-filter adjustments, kept on disk so they survive the app being closed. Each filter has its
// own set (Original included), keyed by the enum name.
object FilterAdjustmentStore {
    private const val PREFS = "camera_filter_adjustments"
    private val FIELDS = listOf(
        "strength", "brightness", "exposure", "contrast", "highlights",
        "shadows", "vignette", "saturation", "warmth", "tint", "sharpness"
    )

    private var appContext: Context? = null
    private val cache = HashMap<CameraFilterOption, FilterAdjustments>()

    fun initialize(context: Context) {
        appContext = context.applicationContext
    }

    private val prefs get() = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(filter: CameraFilterOption): FilterAdjustments = cache.getOrPut(filter) {
        val p = prefs ?: return@getOrPut FilterAdjustments()
        fun get(field: String, default: Int) = p.getInt("${filter.name}_$field", default)
        FilterAdjustments(
            strength = get("strength", FilterAdjustments.DEFAULT_STRENGTH),
            brightness = get("brightness", 0),
            exposure = get("exposure", 0),
            contrast = get("contrast", 0),
            highlights = get("highlights", 0),
            shadows = get("shadows", 0),
            vignette = get("vignette", 0),
            saturation = get("saturation", 0),
            warmth = get("warmth", 0),
            tint = get("tint", 0),
            sharpness = get("sharpness", 0)
        )
    }

    fun save(filter: CameraFilterOption, value: FilterAdjustments) {
        cache[filter] = value
        val editor = prefs?.edit() ?: return
        if (value.isNeutral) {
            FIELDS.forEach { editor.remove("${filter.name}_$it") }
        } else {
            editor.putInt("${filter.name}_strength", value.strength)
            editor.putInt("${filter.name}_brightness", value.brightness)
            editor.putInt("${filter.name}_exposure", value.exposure)
            editor.putInt("${filter.name}_contrast", value.contrast)
            editor.putInt("${filter.name}_highlights", value.highlights)
            editor.putInt("${filter.name}_shadows", value.shadows)
            editor.putInt("${filter.name}_vignette", value.vignette)
            editor.putInt("${filter.name}_saturation", value.saturation)
            editor.putInt("${filter.name}_warmth", value.warmth)
            editor.putInt("${filter.name}_tint", value.tint)
            editor.putInt("${filter.name}_sharpness", value.sharpness)
        }
        editor.apply()
    }
}

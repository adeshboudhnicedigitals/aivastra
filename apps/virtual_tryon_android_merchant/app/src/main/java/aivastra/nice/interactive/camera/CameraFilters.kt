package aivastra.nice.interactive.camera

import android.graphics.ColorMatrix

// Deliberately restrained looks. This is a try-on app: the captured face/skin tone is fed to the
// generation workflow, so heavy grading (Noir, Sepia, Dramatic, Vintage, ...) would degrade the
// result. Every look stays close to the original colours, but each one is tinted/toned distinctly
// enough to be told apart in the preview, and sits slightly darker than the raw feed (small
// negative brightness) so skin and fabric keep depth instead of looking washed out.
enum class CameraFilterOption(
    val label: String,
    private val saturation: Float = 1f,
    private val contrast: Float = 1f,
    // Added to each channel on a 0..255 scale.
    private val brightness: Float = 0f,
    private val red: Float = 1f,
    private val green: Float = 1f,
    private val blue: Float = 1f
) {
    ORIGINAL("Original"),
    NATURAL("Natural", saturation = 1.15f, contrast = 1.12f, brightness = -8f),
    SOFT("Soft", saturation = 0.75f, contrast = 0.85f, brightness = 0f, red = 1.04f, blue = 1.04f),
    FRESH("Fresh", saturation = 1.4f, contrast = 1.08f, brightness = -8f, red = 0.92f, green = 1.06f, blue = 1.06f),
    BRIGHT("Bright", saturation = 1.1f, contrast = 1.06f, brightness = 8f),
    BEAUTY("Beauty", saturation = 1.12f, contrast = 0.93f, brightness = -2f, red = 1.12f, green = 1.0f, blue = 0.92f),
    CLASSIC("Classic", saturation = 0.6f, contrast = 1.2f, brightness = -10f, red = 1.06f, blue = 0.9f),
    PASTEL("Pastel", saturation = 0.6f, contrast = 0.82f, brightness = 8f, red = 1.05f, blue = 1.08f),
    GLOW("Glow", saturation = 1.1f, contrast = 0.88f, brightness = 4f, red = 1.1f, green = 1.02f, blue = 0.96f),
    ROSE("Rose", saturation = 1.2f, contrast = 1.06f, brightness = -8f, red = 1.2f, green = 0.9f, blue = 1.08f),
    GOLDEN("Golden", saturation = 1.25f, contrast = 1.08f, brightness = -6f, red = 1.22f, green = 1.05f, blue = 0.7f),
    WARM("Warm", saturation = 1.06f, contrast = 1.05f, brightness = -8f, red = 1.18f, blue = 0.8f),
    COOL("Cool", saturation = 1.0f, contrast = 1.05f, brightness = -8f, red = 0.8f, blue = 1.2f),
    ICE("Ice", saturation = 0.7f, contrast = 1.1f, brightness = -4f, red = 0.75f, green = 1.0f, blue = 1.25f),
    MINT("Mint", saturation = 1.2f, contrast = 1.05f, brightness = -6f, red = 0.8f, green = 1.15f, blue = 1.0f),
    CRISP("Crisp", saturation = 1.25f, contrast = 1.35f, brightness = -18f),
    PEACH("Peach", saturation = 1.15f, contrast = 1.04f, brightness = -4f, red = 1.15f, green = 1.0f, blue = 0.86f),
    LAVENDER("Lavender", saturation = 0.95f, contrast = 1.04f, brightness = -4f, red = 1.06f, green = 0.92f, blue = 1.16f),
    FOREST("Forest", saturation = 1.1f, contrast = 1.12f, brightness = -14f, red = 0.88f, green = 1.1f, blue = 0.9f),
    MOODY("Moody", saturation = 0.85f, contrast = 1.25f, brightness = -22f, red = 1.02f, blue = 1.04f),
    VIVID("Vivid", saturation = 1.55f, contrast = 1.15f, brightness = -8f),
    MATTE("Matte", saturation = 0.85f, contrast = 0.88f, brightness = -6f, red = 1.02f, green = 1.02f);

    val isOriginal: Boolean get() = this == ORIGINAL

    /**
     * @param intensity 1 = the look as designed, 0 = no effect, >1 pushes it further. Each
     *   parameter is interpolated from its neutral value, so the slider fades the look in/out
     *   instead of just dimming it.
     * @param enhance adds a light, fixed contrast/saturation lift on top. Used for the captured
     *   photo only: a still gets a little extra punch, scaled by [intensity], while the live
     *   preview stays a plain read of the look.
     */
    fun toColorMatrix(intensity: Float = 1f, enhance: Boolean = false): ColorMatrix {
        fun mix(neutral: Float, target: Float) = neutral + (target - neutral) * intensity

        var sat = mix(1f, saturation)
        var con = mix(1f, contrast)
        val bri = mix(0f, brightness)
        if (enhance && !isOriginal) {
            sat *= 1f + 0.06f * intensity
            con *= 1f + 0.05f * intensity
        }
        val r = mix(1f, red)
        val g = mix(1f, green)
        val b = mix(1f, blue)

        val matrix = ColorMatrix().apply { setSaturation(sat) }
        // Contrast pivots around mid-grey, so the offset keeps 128 fixed as the scale changes.
        val pivot = 128f * (1f - con)
        val offset = bri + pivot
        matrix.postConcat(
            ColorMatrix(
                floatArrayOf(
                    r * con, 0f, 0f, 0f, offset,
                    0f, g * con, 0f, 0f, offset,
                    0f, 0f, b * con, 0f, offset,
                    0f, 0f, 0f, 1f, 0f
                )
            )
        )
        return matrix
    }
}

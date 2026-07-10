package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import android.util.Log
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import java.nio.ByteBuffer
import java.nio.ByteOrder

class HDRContrastBoostFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;           // camera texture
            uniform sampler2D faceMaskTexture;             // face mask grayscale (1 inside face)
            uniform sampler2D featureMaskTexture;          // eyes/lips mask grayscale (1 for eyes/lips)

            varying vec2 vTextureCoord;

            uniform float brightness;       // e.g. 0.0 - 0.3
            uniform float smoothness;       // e.g. 0.0 - 0.5
            uniform float warmth;           // e.g. 0.0 - 0.1
            uniform float sharpenStrength;  // e.g. 0.0 - 1.0
            uniform float hdrStrength;      // e.g. 0.0 - 1.0

            const float offset = 1.0 / 300.0;

            vec4 blur9(samplerExternalOES tex, vec2 uv) {
                vec4 sum = vec4(0.0);
                sum += texture2D(tex, uv + vec2(-offset, -offset));
                sum += texture2D(tex, uv + vec2(-offset, 0.0));
                sum += texture2D(tex, uv + vec2(-offset, offset));
                sum += texture2D(tex, uv + vec2(0.0, -offset));
                sum += texture2D(tex, uv);
                sum += texture2D(tex, uv + vec2(0.0, offset));
                sum += texture2D(tex, uv + vec2(offset, -offset));
                sum += texture2D(tex, uv + vec2(offset, 0.0));
                sum += texture2D(tex, uv + vec2(offset, offset));
                return sum / 9.0;
            }

            vec4 sharpen(samplerExternalOES tex, vec2 uv) {
                vec4 original = texture2D(tex, uv);
                vec4 blurred = blur9(tex, uv);
                vec4 sharp = original + sharpenStrength * (original - blurred);
                return clamp(sharp, 0.0, 1.0);
            }

            vec4 hdrEnhance(samplerExternalOES tex, vec2 uv) {
                vec4 original = texture2D(tex, uv);
                vec4 blurred = blur9(tex, uv);
                vec4 enhanced = original + hdrStrength * (original - blurred);
                return clamp(enhanced, 0.0, 1.0);
            }

            void main() {
                vec4 origColor = texture2D(sTexture, vTextureCoord);
                float faceMask = texture2D(faceMaskTexture, vTextureCoord).r;
                float featureMask = texture2D(featureMaskTexture, vTextureCoord).r;

                float skinMask = max(faceMask - featureMask, 0.0);

                vec4 blurredColor = blur9(sTexture, vTextureCoord);
                vec4 smoothColor = mix(origColor, blurredColor, smoothness * skinMask);

                smoothColor.r += warmth * skinMask;
                smoothColor.g += warmth * 0.5 * skinMask;

                vec4 sharpColor = sharpen(sTexture, vTextureCoord);
                vec4 colorWithSharpen = mix(smoothColor, sharpColor, featureMask);

                vec4 finalColor = mix(colorWithSharpen, hdrEnhance(sTexture, vTextureCoord), hdrStrength * faceMask);

                finalColor.rgb += brightness * faceMask;

                finalColor = clamp(finalColor, 0.0, 1.0);

                gl_FragColor = finalColor;
            }
        """
    }

    private var brightnessLocation = -1
    private var smoothnessLocation = -1
    private var warmthLocation = -1
    private var sharpenStrengthLocation = -1
    private var hdrStrengthLocation = -1
    private var faceMaskTextureLocation = -1
    private var featureMaskTextureLocation = -1
    private var sTextureLocation = -1

    var brightness = 0.1f
    var smoothness = 0.3f
    var warmth = 0.05f
    var sharpenStrength = 0.7f
    var hdrStrength = 0.5f

    // These must be set externally by your app with valid texture IDs
    var faceMaskTextureId = -1
    var featureMaskTextureId = -1

    private var dummyWhiteTextureId = -1

    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        brightnessLocation = GLES20.glGetUniformLocation(programHandle, "brightness")
        smoothnessLocation = GLES20.glGetUniformLocation(programHandle, "smoothness")
        warmthLocation = GLES20.glGetUniformLocation(programHandle, "warmth")
        sharpenStrengthLocation = GLES20.glGetUniformLocation(programHandle, "sharpenStrength")
        hdrStrengthLocation = GLES20.glGetUniformLocation(programHandle, "hdrStrength")
        faceMaskTextureLocation = GLES20.glGetUniformLocation(programHandle, "faceMaskTexture")
        featureMaskTextureLocation = GLES20.glGetUniformLocation(programHandle, "featureMaskTexture")
        sTextureLocation = GLES20.glGetUniformLocation(programHandle, "sTexture")

        logUniformLocations()
    }

    private fun logUniformLocations() {
        val locs = listOf(
            "brightness" to brightnessLocation,
            "smoothness" to smoothnessLocation,
            "warmth" to warmthLocation,
            "sharpenStrength" to sharpenStrengthLocation,
            "hdrStrength" to hdrStrengthLocation,
            "faceMaskTexture" to faceMaskTextureLocation,
            "featureMaskTexture" to featureMaskTextureLocation,
            "sTexture" to sTextureLocation
        )
        for ((name, loc) in locs) {
            if (loc == -1) {
                Log.w("HDRContrastBoostFilter", "Uniform $name not found in shader (location = -1)")
            } else {
                Log.d("HDRContrastBoostFilter", "Uniform $name location = $loc")
            }
        }
    }

    private fun createWhiteTexture(): Int {
        if (dummyWhiteTextureId != -1) return dummyWhiteTextureId

        val texIds = IntArray(1)
        GLES20.glGenTextures(1, texIds, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texIds[0])

        val pixel = intArrayOf(0xFF000000.toInt()) // black pixel (fully opaque)
        val buffer = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())
        buffer.asIntBuffer().put(pixel).position(0)

        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            GLES20.GL_RGBA,
            1,
            1,
            0,
            GLES20.GL_RGBA,
            GLES20.GL_UNSIGNED_BYTE,
            buffer
        )

        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_NEAREST)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_NEAREST)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)

        dummyWhiteTextureId = texIds[0]
        Log.d("HDRContrastBoostFilter", "Created dummy black texture ID: $dummyWhiteTextureId")
        return dummyWhiteTextureId
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)

        // Use dummy white texture if mask textures are invalid
        if (faceMaskTextureId == -1) {
            faceMaskTextureId = createWhiteTexture()
        }
        if (featureMaskTextureId == -1) {
            featureMaskTextureId = createWhiteTexture()
        }

        // Bind face mask texture on texture unit 1
        if (faceMaskTextureLocation != -1) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, faceMaskTextureId)
            GLES20.glUniform1i(faceMaskTextureLocation, 1)
        }

        // Bind feature mask texture on texture unit 2
        if (featureMaskTextureLocation != -1) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE2)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, featureMaskTextureId)
            GLES20.glUniform1i(featureMaskTextureLocation, 2)
        }

        // Set float uniforms if locations valid
        if (brightnessLocation != -1) GLES20.glUniform1f(brightnessLocation, brightness)
        if (smoothnessLocation != -1) GLES20.glUniform1f(smoothnessLocation, smoothness)
        if (warmthLocation != -1) GLES20.glUniform1f(warmthLocation, warmth)
        if (sharpenStrengthLocation != -1) GLES20.glUniform1f(sharpenStrengthLocation, sharpenStrength)
        if (hdrStrengthLocation != -1) GLES20.glUniform1f(hdrStrengthLocation, hdrStrength)

        // Important: DO NOT bind or set sTexture here! CameraView binds the external camera texture for you.
        // Just ensure uniform location sTextureLocation is set to 0 by CameraView automatically.

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0) // Reset active texture to 0 for safety
    }

    fun getName(): String {
        return "HDRContrast"
    }
}

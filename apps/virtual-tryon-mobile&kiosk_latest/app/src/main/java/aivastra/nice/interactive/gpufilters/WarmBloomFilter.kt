package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class WarmBloomFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;

            uniform vec2 resolution;
            uniform float smoothAmount;
            uniform float brightnessBoost;
            uniform float contrastAmount;

            // Strong blur for skin smoothing
            vec4 strongBlur(samplerExternalOES image, vec2 uv, vec2 res) {
                float blurSize = 2.5 / res.y;
                vec4 sum = vec4(0.0);
                sum += texture2D(image, uv + vec2(-blurSize, -blurSize)) * 0.2;
                sum += texture2D(image, uv + vec2(-blurSize,  blurSize)) * 0.2;
                sum += texture2D(image, uv + vec2( blurSize, -blurSize)) * 0.2;
                sum += texture2D(image, uv + vec2( blurSize,  blurSize)) * 0.2;
                sum += texture2D(image, uv) * 0.2;
                return sum;
            }

            void main() {
                vec4 original = texture2D(sTexture, vTextureCoord);
                vec4 blurred = strongBlur(sTexture, vTextureCoord, resolution);

                // Smooth skin by mixing original and blurred strongly
                vec4 smooth = mix(original, blurred, smoothAmount);

                // Unsharp mask to gently restore edges/details but keep skin smooth
                vec4 highPass = original - blurred + vec4(0.5);
                vec4 sharpened = smooth + (highPass - 0.5) * 0.4;

                // Reduced brightness boost
                sharpened.rgb += vec3(brightnessBoost);

                // Add slight warm peach tone
                sharpened.r += 0.03;
                sharpened.g += 0.015;

                // Slight desaturation to reduce redness
                float gray = dot(sharpened.rgb, vec3(0.299, 0.587, 0.114));
                sharpened.rgb = mix(sharpened.rgb, vec3(gray), 0.1);

                // Add slight contrast to avoid washed out look
                vec3 contrasted = ((sharpened.rgb - 0.5) * contrastAmount) + 0.5;

                // Slight gamma correction for softness
                contrasted = pow(contrasted, vec3(1.03));

                // Clamp color
                gl_FragColor = clamp(vec4(contrasted, sharpened.a), 0.0, 1.0);
            }
        """
    }

    private var resolutionLocation = -1
    private var smoothAmountLocation = -1
    private var brightnessBoostLocation = -1
    private var contrastAmountLocation = -1

    private var viewWidth = 720f
    private var viewHeight = 1280f

    // You can tweak these default values or expose setters for them
    private var smoothAmount = 0.65f
    private var brightnessBoost = 0.08f
    private var contrastAmount = 1.1f

    override fun setSize(width: Int, height: Int) {
        super.setSize(width, height)
        viewWidth = width.toFloat()
        viewHeight = height.toFloat()
    }

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        resolutionLocation = GLES20.glGetUniformLocation(programHandle, "resolution")
        smoothAmountLocation = GLES20.glGetUniformLocation(programHandle, "smoothAmount")
        brightnessBoostLocation = GLES20.glGetUniformLocation(programHandle, "brightnessBoost")
        contrastAmountLocation = GLES20.glGetUniformLocation(programHandle, "contrastAmount")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
        GLES20.glUniform1f(smoothAmountLocation, smoothAmount)
        GLES20.glUniform1f(brightnessBoostLocation, brightnessBoost)
        GLES20.glUniform1f(contrastAmountLocation, contrastAmount)
    }

    fun setSmoothAmount(value: Float) {
        smoothAmount = value.coerceIn(0f, 1f)
    }

    fun setBrightnessBoost(value: Float) {
        brightnessBoost = value.coerceIn(0f, 1f)
    }

    fun setContrastAmount(value: Float) {
        contrastAmount = value.coerceIn(0.5f, 2f)
    }

    fun getName(): String = "WarmBloom"
}

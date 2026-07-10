package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class SoftSkinFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;

            uniform float smooth;       // smoothing intensity
            uniform float light;        // brightness control
            uniform vec2 resolution;    // viewport resolution

            // Simple 5-sample blur for soft smoothing
            vec4 simpleBlur(samplerExternalOES image, vec2 uv, vec2 res) {
                float offset = 1.0 / res.y;
                vec4 color = vec4(0.0);
                color += texture2D(image, uv + vec2(-offset, -offset));
                color += texture2D(image, uv + vec2(-offset,  offset));
                color += texture2D(image, uv + vec2( offset, -offset));
                color += texture2D(image, uv + vec2( offset,  offset));
                color += texture2D(image, uv);
                return color / 5.0;
            }

            void main() {
                vec2 uv = $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;
                vec4 original = texture2D(sTexture, uv);
                vec4 blurred = simpleBlur(sTexture, uv, resolution);

                // Blend original and blurred based on smooth factor
                vec4 smoothColor = mix(original, blurred, smooth);

                // Warm natural tone tint (slight peach)
                smoothColor.r += 0.03;
                smoothColor.g += 0.015;

                // Brightness adjustment
                smoothColor.rgb *= light;

                // Slight gamma correction for softness
                smoothColor.rgb = pow(smoothColor.rgb, vec3(1.05));

                gl_FragColor = clamp(smoothColor, 0.0, 1.0);
            }
        """
    }

    private var smoothLocation = -1
    private var lightLocation = -1
    private var resolutionLocation = -1

    private var smoothLevel = 0.45f   // Adjust for smoothing amount (0–1)
    private var lightLevel = 1.08f    // Adjust for brightness

    private var viewWidth = 720f
    private var viewHeight = 1280f

    override fun setSize(width: Int, height: Int) {
        super.setSize(width, height)
        viewWidth = width.toFloat()
        viewHeight = height.toFloat()
    }

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        smoothLocation = GLES20.glGetUniformLocation(programHandle, "smooth")
        lightLocation = GLES20.glGetUniformLocation(programHandle, "light")
        resolutionLocation = GLES20.glGetUniformLocation(programHandle, "resolution")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(smoothLocation, smoothLevel)
        GLES20.glUniform1f(lightLocation, lightLevel)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
    }

    fun setSmoothLevel(level: Float) {
        smoothLevel = level.coerceIn(0f, 1f)
    }

    fun setLightLevel(level: Float) {
        lightLevel = level.coerceIn(0.5f, 2f)
    }

    fun getName(): String = "SoftSkin"
}

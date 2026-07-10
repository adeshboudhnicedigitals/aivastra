package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class LumaGlowFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;

            uniform float brightness; // 0.0 to 1.0, default 0.6
            uniform float contrast;   // 0.0 to 2.0, default 1.15
            uniform float saturation; // 0.0 to 2.0, default 1.3

            vec3 applySaturation(vec3 color, float sat) {
                float gray = dot(color, vec3(0.299, 0.587, 0.114));
                return mix(vec3(gray), color, sat);
            }

            void main() {
                vec4 color = texture2D(sTexture, vTextureCoord);

                // Brightness shift (-0.5 to +0.5 mapped)
                color.rgb += (brightness - 0.5);

                // Contrast
                color.rgb = ((color.rgb - 0.5) * contrast) + 0.5;

                // Saturation
                color.rgb = applySaturation(color.rgb, saturation);

                gl_FragColor = clamp(color, 0.0, 1.0);
            }
        """
    }

    private var brightnessLocation = -1
    private var contrastLocation = -1
    private var saturationLocation = -1

    // Fixed good-looking defaults (no sliders)
    private val brightness = 0.6f
    private val contrast = 1.15f
    private val saturation = 1.3f

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        brightnessLocation = GLES20.glGetUniformLocation(programHandle, "brightness")
        contrastLocation = GLES20.glGetUniformLocation(programHandle, "contrast")
        saturationLocation = GLES20.glGetUniformLocation(programHandle, "saturation")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(brightnessLocation, brightness)
        GLES20.glUniform1f(contrastLocation, contrast)
        GLES20.glUniform1f(saturationLocation, saturation)
    }

    fun getName(): String = "LumaGlow"
}

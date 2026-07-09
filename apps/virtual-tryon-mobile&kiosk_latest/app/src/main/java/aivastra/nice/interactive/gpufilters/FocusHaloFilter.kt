package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class FocusHaloFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;
            uniform vec2 resolution;
            uniform float vignetteStrength;  // 0.0 - 1.0

            void main() {
                vec2 uv = vTextureCoord;
                vec4 color = texture2D(sTexture, uv);

               vec2 position = (uv - vec2(0.5)) * vec2(1.0, resolution.y / resolution.x);
               float len = length(position);
               float vignette = smoothstep(0.7, 0.4, len);
               vignette = mix(1.0, vignette, vignetteStrength);

                color.rgb *= vignette;

                gl_FragColor = clamp(color, 0.0, 1.0);
            }
        """
    }

    private var resolutionLocation = -1
    private var vignetteStrengthLocation = -1

    private var viewWidth = 720f
    private var viewHeight = 1280f

    private val vignetteStrength = 0.7f  // subtle vignette

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
        vignetteStrengthLocation = GLES20.glGetUniformLocation(programHandle, "vignetteStrength")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
        GLES20.glUniform1f(vignetteStrengthLocation, vignetteStrength)
    }

    fun getName(): String = "FocusHalo"
}

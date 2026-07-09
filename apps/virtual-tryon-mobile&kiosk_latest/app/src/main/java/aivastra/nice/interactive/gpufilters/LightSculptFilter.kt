package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class LightSculptFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;
            uniform float highlights;  // 0.0 - 2.0, 1.0 is neutral
            uniform float shadows;     // 0.0 - 2.0, 1.0 is neutral

            void main() {
                vec4 color = texture2D(sTexture, vTextureCoord);

                // brighten/darken highlights
                float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                if(lum > 0.5) {
                    color.rgb *= highlights;
                } else {
                    color.rgb *= shadows;
                }

                gl_FragColor = clamp(color, 0.0, 1.0);
            }
        """
    }

    private var highlightsLocation = -1
    private var shadowsLocation = -1

    private val highlights = 1.1f
    private val shadows = 1.05f

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        highlightsLocation = GLES20.glGetUniformLocation(programHandle, "highlights")
        shadowsLocation = GLES20.glGetUniformLocation(programHandle, "shadows")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(highlightsLocation, highlights)
        GLES20.glUniform1f(shadowsLocation, shadows)
    }

    fun getName(): String = "LightSculpt"
}

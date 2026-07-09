package aivastra.nice.interactive.gpufilters
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class CurveCraftFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;

           vec3 toneCurve(vec3 color) {
                return pow(color, vec3(0.85)) * 1.1 - 0.05;
             }

            void main() {
                vec4 color = texture2D(sTexture, vTextureCoord);
                color.rgb = toneCurve(color.rgb);
                gl_FragColor = clamp(color, 0.0, 1.0);
            }
        """
    }

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    fun getName(): String = "CurveCraft"
}

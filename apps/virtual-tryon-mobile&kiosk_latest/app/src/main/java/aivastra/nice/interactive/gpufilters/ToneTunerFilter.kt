package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class ToneTunerFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;
            uniform float temperature;  // range -1.0 (cool) to 1.0 (warm)

            void main() {
                vec4 color = texture2D(sTexture, vTextureCoord);

                float temp = temperature * 0.1; // scale factor
                color.r += temp;
                color.b -= temp;

                gl_FragColor = clamp(color, 0.0, 1.0);
            }
        """
    }

    private var temperatureLocation = -1
    private var temperature = 0.15f

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        temperatureLocation = GLES20.glGetUniformLocation(programHandle, "temperature")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(temperatureLocation, temperature)
    }

    fun setTemperature(value: Float) {
        temperature = value.coerceIn(-1f, 1f)
    }

    fun getName(): String = "ToneTuner"
}

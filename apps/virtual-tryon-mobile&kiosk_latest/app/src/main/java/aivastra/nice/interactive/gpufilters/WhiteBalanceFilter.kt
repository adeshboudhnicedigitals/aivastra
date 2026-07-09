package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import com.otaliastudios.cameraview.filter.OneParameterFilter

class WhiteBalanceFilter : BaseFilter(), OneParameterFilter {

    private var temperature = 0f
    private var tempLocation = -1

    companion object {
        private const val FRAGMENT_SHADER = """
    #extension GL_OES_EGL_image_external : require
    precision mediump float;

    uniform samplerExternalOES tex_sampler_0;
    uniform float temperature;
    varying vec2 vTextureCoord;

    void main() {
        vec4 color = texture2D(tex_sampler_0, vTextureCoord);
        color.r += temperature * 0.1;
        color.b -= temperature * 0.1;
        gl_FragColor = color;
    }
"""
    }

    override fun setParameter1(value: Float) {
        temperature = value
    }

    override fun getParameter1(): Float = temperature

    @NonNull
    override fun getFragmentShader() = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        tempLocation = GLES20.glGetUniformLocation(programHandle, "temperature")
    }

    override fun onPreDraw(timestampUs: Long, transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(tempLocation, temperature)
    }

    fun getName() = "White Balance"
}

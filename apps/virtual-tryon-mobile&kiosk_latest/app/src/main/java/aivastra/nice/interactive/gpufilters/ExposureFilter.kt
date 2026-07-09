package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import com.otaliastudios.cameraview.filter.OneParameterFilter


class ExposureFilter : BaseFilter(), OneParameterFilter {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES tex_sampler_0;
            uniform float exposure; // stops, e.g. -2..2 range, 0 no change
            varying vec2 vTextureCoord;

            void main() {
                vec4 color = texture2D(tex_sampler_0, vTextureCoord);
                vec3 result = color.rgb * pow(2.0, exposure);
                gl_FragColor = vec4(result, color.a);
            }
        """
    }

    private var exposure = 0f
    private var exposureLocation = -1

    fun setExposure(value: Float) {
        exposure = value.coerceIn(-5f, 5f)
    }

    fun getExposure(): Float = exposure

    override fun setParameter1(value: Float) = setExposure(value)

    override fun getParameter1(): Float = getExposure()

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        exposureLocation = GLES20.glGetUniformLocation(programHandle, "exposure")
        if (exposureLocation == -1) throw RuntimeException("Could not get uniform location for exposure")
    }

    override fun onDestroy() {
        super.onDestroy()
        exposureLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(exposureLocation, exposure)
        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) throw RuntimeException("glUniform1f failed: $error")
    }

    fun getName(): String {
        return "Exposure"
    }
}
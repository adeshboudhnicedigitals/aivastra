package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import com.otaliastudios.cameraview.filter.OneParameterFilter

class ContrastFilter : BaseFilter(), OneParameterFilter {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES tex_sampler_0;
            uniform float contrast; // 0 = gray, 1 = original, >1 more contrast
            varying vec2 vTextureCoord;

            void main() {
                vec4 color = texture2D(tex_sampler_0, vTextureCoord);
                vec3 result = ((color.rgb - 0.5) * contrast) + 0.5;
                gl_FragColor = vec4(result, color.a);
            }
        """
    }

    private var contrast = 1f
    private var contrastLocation = -1

    fun setContrast(value: Float) {
        contrast = value.coerceAtLeast(0f)
    }

    fun getContrast(): Float = contrast

    override fun setParameter1(value: Float) = setContrast(value)

    override fun getParameter1(): Float = getContrast()

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        contrastLocation = GLES20.glGetUniformLocation(programHandle, "contrast")
        if (contrastLocation == -1) throw RuntimeException("Could not get uniform location for contrast")
    }

    override fun onDestroy() {
        super.onDestroy()
        contrastLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(contrastLocation, contrast)
        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) throw RuntimeException("glUniform1f failed: $error")
    }

    fun getName(): String {
        return "Contrast"
    }
}
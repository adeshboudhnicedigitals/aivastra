package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import com.otaliastudios.cameraview.filter.OneParameterFilter
import jp.co.cyberagent.android.gpuimage.filter.GPUImageSaturationFilter

class SaturationFilter : BaseFilter(), OneParameterFilter {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES tex_sampler_0;
            uniform float saturation;  // 0 = grayscale, 1 = original color
            varying vec2 vTextureCoord;

            void main() {
                vec4 color = texture2D(tex_sampler_0, vTextureCoord);
                float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                vec3 result = mix(vec3(gray), color.rgb, saturation);
                gl_FragColor = vec4(result, color.a);
            }
        """
    }

    private var saturation = 1f
    private var saturationLocation = -1

    fun setSaturation(value: Float) {
        saturation = value.coerceIn(0f, 2f)
    }

    fun getSaturation(): Float = saturation

    override fun setParameter1(value: Float) = setSaturation(value)

    override fun getParameter1(): Float = getSaturation()

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        saturationLocation = GLES20.glGetUniformLocation(programHandle, "saturation")
        if (saturationLocation == -1) throw RuntimeException("Could not get uniform location for saturation")
    }

    override fun onDestroy() {
        super.onDestroy()
        saturationLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(saturationLocation, saturation)
        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) throw RuntimeException("glUniform1f failed: $error")
    }

    fun getName(): String {
        return "Saturation"
    }
}
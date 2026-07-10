package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import android.opengl.GLES20.glUniform1f
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import com.otaliastudios.cameraview.filter.OneParameterFilter


class HueFilter : BaseFilter(), OneParameterFilter {

    companion object {

        private const val FRAGMENT_SHADER = """
    #extension GL_OES_EGL_image_external : require
    precision mediump float;
    uniform samplerExternalOES tex_sampler_0;
    uniform float hue;
    varying vec2 vTextureCoord;

    const mat3 RGB2YIQ = mat3(
        0.299, 0.587, 0.114,
        0.595716, -0.274453, -0.321263,
        0.211456, -0.522591, 0.311135
    );

    const mat3 YIQ2RGB = mat3(
        1.0, 0.9563, 0.6210,
        1.0, -0.2721, -0.6474,
        1.0, -1.1070, 1.7046
    );

    void main() {
      vec4 color = texture2D(tex_sampler_0, vTextureCoord);
      vec3 yiq = RGB2YIQ * color.rgb;
      float originalHue = atan(yiq.z, yiq.y);
      float chroma = length(yiq.yz);
      float newHue = originalHue + hue;
      yiq.y = chroma * cos(newHue);
      yiq.z = chroma * sin(newHue);
      vec3 rgb = YIQ2RGB * yiq;
      gl_FragColor = vec4(rgb, color.a);
    }
"""

    }

    private var hue: Float = 0f
    private var hueLocation = -1

    fun setHue(hueRadians: Float) {
        hue = hueRadians
    }

    fun getHue(): Float = hue

    override fun setParameter1(value: Float) {
        setHue(value)
    }

    override fun getParameter1(): Float = getHue()

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        hueLocation = GLES20.glGetUniformLocation(programHandle, "hue")
        if (hueLocation == -1) {
            throw RuntimeException("Could not get uniform location for 'hue'")
        }
    }

    fun getName(): String {
        return "Hue"
    }

    override fun onDestroy() {
        super.onDestroy()
        hueLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(hueLocation, hue)
        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) {
            throw RuntimeException("glUniform1f failed with error: $error")
        }
    }
}

package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class EdgeDefineFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;
            uniform vec2 resolution;
            uniform float strength;

            vec4 blur(samplerExternalOES image, vec2 uv, vec2 res) {
                float offset = 2.0 / res.y;
                vec4 sum = vec4(0.0);
                sum += texture2D(image, uv + vec2(-offset, -offset)) * 0.2;
                sum += texture2D(image, uv + vec2(-offset,  offset)) * 0.2;
                sum += texture2D(image, uv + vec2( offset, -offset)) * 0.2;
                sum += texture2D(image, uv + vec2( offset,  offset)) * 0.2;
                sum += texture2D(image, uv) * 0.2;
                return sum;
            }

            void main() {
                vec4 original = texture2D(sTexture, vTextureCoord);
                vec4 blurred = blur(sTexture, vTextureCoord, resolution);

                vec4 highPass = original - blurred + vec4(0.5);
                vec4 result = original + strength * (highPass - vec4(0.5));

                gl_FragColor = clamp(result, 0.0, 1.0);
            }
        """
    }

    private var resolutionLocation = -1
    private var strengthLocation = -1

    private var viewWidth = 720f
    private var viewHeight = 1280f

    private val strength = 0.6f  // subtle sharpening

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
        strengthLocation = GLES20.glGetUniformLocation(programHandle, "strength")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
        GLES20.glUniform1f(strengthLocation, strength)
    }

    fun getName(): String = "EdgeDefine"
}

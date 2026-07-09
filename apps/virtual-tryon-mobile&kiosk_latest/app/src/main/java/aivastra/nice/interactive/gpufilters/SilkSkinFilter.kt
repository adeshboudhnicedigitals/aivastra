package aivastra.nice.interactive.gpufilters
import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class SilkSkinFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;
            uniform vec2 resolution;
            uniform float blurRadius;

            // Approximate bilateral blur using 5-sample weighted blur
            vec4 bilateralBlur(samplerExternalOES image, vec2 uv, vec2 res, float radius) {
                float offset = radius / res.y;
                vec4 center = texture2D(image, uv);
                vec4 sum = center * 0.4;
                sum += texture2D(image, uv + vec2(-offset, 0.0)) * 0.15;
                sum += texture2D(image, uv + vec2(offset, 0.0)) * 0.15;
                sum += texture2D(image, uv + vec2(0.0, -offset)) * 0.15;
                sum += texture2D(image, uv + vec2(0.0, offset)) * 0.15;
                return sum;
            }

            void main() {
                vec4 color = bilateralBlur(sTexture, vTextureCoord, resolution, blurRadius);
                gl_FragColor = color;
            }
        """
    }

    private var resolutionLocation = -1
    private var blurRadiusLocation = -1

    private var viewWidth = 720f
    private var viewHeight = 1280f

    private var blurRadius = 3.0f // tweak for smoothing strength

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
        blurRadiusLocation = GLES20.glGetUniformLocation(programHandle, "blurRadius")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
        GLES20.glUniform1f(blurRadiusLocation, blurRadius)
    }

    fun setBlurRadius(radius: Float) {
        blurRadius = radius.coerceIn(0f, 10f)
    }

    fun getName(): String = "Bilateral"
}
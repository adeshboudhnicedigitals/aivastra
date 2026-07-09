package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class BeautyFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        uniform samplerExternalOES sTexture;
        varying vec2 $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;

        uniform float smooth;
        uniform float light;
        uniform vec2 resolution;

        // small blur for soft skin, not background
        vec4 smoothBlur(samplerExternalOES image, vec2 uv) {
            vec2 off = 1.0 / resolution;
            vec4 sum = vec4(0.0);
            sum += texture2D(image, uv + vec2(-off.x, -off.y)) * 0.20;
            sum += texture2D(image, uv + vec2( off.x, -off.y)) * 0.20;
            sum += texture2D(image, uv + vec2(-off.x,  off.y)) * 0.20;
            sum += texture2D(image, uv + vec2( off.x,  off.y)) * 0.20;
            sum += texture2D(image, uv) * 0.20;
            return sum;
        }

        void main() {
            vec2 uv = $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;

            vec4 original = texture2D(sTexture, uv);
            vec4 blur = smoothBlur(sTexture, uv);

            // subtle skin smoothing
            vec4 beauty = mix(original, blur, smooth);

            // soft natural warm tone (NO whitening)
            beauty.r += 0.010;
            beauty.g += 0.005;

            // controlled light / exposure
            beauty.rgb *= light;

            gl_FragColor = beauty;
        }
        """
    }

    // ✅ Final good looks — balanced, natural
    private var smoothLevel = 0.45f   // smooth but keeps texture
    private var lightLevel  = 1.08f   // slight lighting but not bright

    private var smoothLocation = -1
    private var lightLocation = -1
    private var resolutionLocation = -1

    private var viewWidth = 720f
    private var viewHeight = 1280f

    override fun setSize(width: Int, height: Int) {
        super.setSize(width, height)
        viewWidth = width.toFloat()
        viewHeight = height.toFloat()
    }

    @NonNull
    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        smoothLocation = GLES20.glGetUniformLocation(programHandle, "smooth")
        lightLocation = GLES20.glGetUniformLocation(programHandle, "light")
        resolutionLocation = GLES20.glGetUniformLocation(programHandle, "resolution")
    }

    override fun onDestroy() {
        super.onDestroy()
        smoothLocation = -1
        lightLocation = -1
        resolutionLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(smoothLocation, smoothLevel)
        GLES20.glUniform1f(lightLocation, lightLevel)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
    }

    fun getName(): String = "BeautyNatural"
}

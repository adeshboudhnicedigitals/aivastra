package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class VelvetFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        uniform samplerExternalOES sTexture;
        varying vec2 $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;

        uniform vec2 resolution;

        // very small blur for clean natural face
        vec4 tinyBlur(samplerExternalOES tex, vec2 uv) {
            vec2 o = 1.0 / resolution;
            return (
                texture2D(tex, uv + vec2(-o.x, -o.y)) +
                texture2D(tex, uv + vec2( o.x, -o.y)) +
                texture2D(tex, uv + vec2(-o.x,  o.y)) +
                texture2D(tex, uv + vec2( o.x,  o.y))
            ) * 0.25;
        }

        void main() {
            vec2 uv = $DEFAULT_FRAGMENT_TEXTURE_COORDINATE_NAME;
            vec4 original = texture2D(sTexture, uv);
            vec4 blur = tinyBlur(sTexture, uv);

            // 1) very light smooth (not beauty-filter smooth)
            vec4 clean = mix(original, blur, 0.12);

            // 2) pleasant warm tone
            clean.r *= 1.05;
            clean.g *= 1.01;
            clean.b *= 0.97;

            // 3) slight light enhancement
            clean.rgb *= 1.06;

            // 4) slight soft contrast for freshness
            clean.rgb = (clean.rgb - 0.5) * 1.05 + 0.5;

            gl_FragColor = clean;
        }
        """
    }

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
        resolutionLocation = GLES20.glGetUniformLocation(programHandle, "resolution")
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
    }

    fun getName(): String = "VelvetSoft"
}

package aivastra.nice.interactive.gpufilters

import android.opengl.GLES20
import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class LevelsFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES tex_sampler_0;
            uniform float blackLevel;  // 0..1
            uniform float midLevel;    // gamma >0, typically ~1.0
            uniform float whiteLevel;  // 0..1
            varying vec2 vTextureCoord;

            void main() {
                vec4 color = texture2D(tex_sampler_0, vTextureCoord);

                // Normalize input between black and white levels
                vec3 normalized = (color.rgb - vec3(blackLevel)) / (whiteLevel - blackLevel);
                normalized = clamp(normalized, 0.0, 1.0);

                // Apply gamma correction (midLevel)
                vec3 corrected = pow(normalized, vec3(1.0 / midLevel));

                gl_FragColor = vec4(corrected, color.a);
            }
        """
    }

    private var blackLevel = 0f
    private var midLevel = 1f
    private var whiteLevel = 1f

    private var blackLevelLocation = -1
    private var midLevelLocation = -1
    private var whiteLevelLocation = -1

    fun setBlackLevel(value: Float) {
        blackLevel = value.coerceIn(0f, 1f)
    }

    fun setMidLevel(value: Float) {
        midLevel = if (value <= 0f) 0.01f else value // avoid zero or negative gamma
    }

    fun setWhiteLevel(value: Float) {
        whiteLevel = value.coerceIn(0f, 1f)
    }

    override fun getFragmentShader(): String = FRAGMENT_SHADER

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        blackLevelLocation = GLES20.glGetUniformLocation(programHandle, "blackLevel")
        midLevelLocation = GLES20.glGetUniformLocation(programHandle, "midLevel")
        whiteLevelLocation = GLES20.glGetUniformLocation(programHandle, "whiteLevel")

        if (blackLevelLocation == -1) throw RuntimeException("Could not get uniform location for blackLevel")
        if (midLevelLocation == -1) throw RuntimeException("Could not get uniform location for midLevel")
        if (whiteLevelLocation == -1) throw RuntimeException("Could not get uniform location for whiteLevel")
    }

    override fun onDestroy() {
        super.onDestroy()
        blackLevelLocation = -1
        midLevelLocation = -1
        whiteLevelLocation = -1
    }

    override fun onPreDraw(timestampUs: Long, @NonNull transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        GLES20.glUniform1f(blackLevelLocation, blackLevel)
        GLES20.glUniform1f(midLevelLocation, midLevel)
        GLES20.glUniform1f(whiteLevelLocation, whiteLevel)

        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) throw RuntimeException("glUniform1f failed: $error")
    }

    fun getName(): String {
        return "Levels"
    }
}
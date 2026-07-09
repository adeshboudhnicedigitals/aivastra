package aivastra.nice.interactive.gpufilters
import com.otaliastudios.cameraview.filter.BaseFilter

class HDRToneFilter : BaseFilter() {
    override fun getFragmentShader(): String = """
       #extension GL_OES_EGL_image_external : require
    precision mediump float;

    uniform samplerExternalOES sTexture;
    varying vec2 vTextureCoord;

    void main() {
        vec4 color = texture2D(sTexture, vTextureCoord);

        float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

        if (lum < 0.5) {
            color.rgb *= 1.2;
        } else {
            color.rgb *= 1.05;
        }

        gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
    }
    """.trimIndent()

    fun getName(): String = "HDRTone"
}

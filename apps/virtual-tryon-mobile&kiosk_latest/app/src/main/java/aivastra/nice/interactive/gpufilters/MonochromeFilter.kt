package aivastra.nice.interactive.gpufilters

import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class MonochromeFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
    #extension GL_OES_EGL_image_external : require
    precision mediump float;

    uniform samplerExternalOES tex_sampler_0;
    varying vec2 vTextureCoord;

    void main() {
        vec4 color = texture2D(tex_sampler_0, vTextureCoord);
        float gray = (color.r + color.g + color.b) / 3.0;
        gl_FragColor = vec4(vec3(gray), 1.0);
    }
"""
    }

    @NonNull
    override fun getFragmentShader() = FRAGMENT_SHADER

    fun getName() = "Monochrome"
}
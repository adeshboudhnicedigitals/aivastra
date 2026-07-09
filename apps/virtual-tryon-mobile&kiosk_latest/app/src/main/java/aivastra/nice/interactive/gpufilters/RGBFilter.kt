package aivastra.nice.interactive.gpufilters

import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter

class RGBFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
    #extension GL_OES_EGL_image_external : require
    precision mediump float;

    uniform samplerExternalOES tex_sampler_0;
    varying vec2 vTextureCoord;

    void main() {
        gl_FragColor = texture2D(tex_sampler_0, vTextureCoord);
    }
"""
    }

    @NonNull
    override fun getFragmentShader() = FRAGMENT_SHADER

    fun getName() = "RGB"
}
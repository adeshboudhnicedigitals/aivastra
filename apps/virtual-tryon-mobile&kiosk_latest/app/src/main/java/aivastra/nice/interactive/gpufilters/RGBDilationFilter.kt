package aivastra.nice.interactive.gpufilters

import androidx.annotation.NonNull
import com.otaliastudios.cameraview.filter.BaseFilter
import java.lang.reflect.Array.setFloat

class RGBDilationFilter : BaseFilter() {

    companion object {
        private const val FRAGMENT_SHADER = """
    #extension GL_OES_EGL_image_external : require
    precision mediump float;

    uniform samplerExternalOES tex_sampler_0;
    varying vec2 vTextureCoord;

    void main() {
        float offset = 0.003;
        vec3 sum = vec3(0.0);

        sum += texture2D(tex_sampler_0, vTextureCoord + vec2(-offset, -offset)).rgb;
        sum += texture2D(tex_sampler_0, vTextureCoord + vec2(offset, -offset)).rgb;
        sum += texture2D(tex_sampler_0, vTextureCoord + vec2(-offset, offset)).rgb;
        sum += texture2D(tex_sampler_0, vTextureCoord + vec2(offset, offset)).rgb;

        sum /= 4.0;
        gl_FragColor = vec4(sum, 1.0);
    }
"""
    }

    @NonNull
    override fun getFragmentShader() = FRAGMENT_SHADER

    fun getName() = "RGB Dilation"
}
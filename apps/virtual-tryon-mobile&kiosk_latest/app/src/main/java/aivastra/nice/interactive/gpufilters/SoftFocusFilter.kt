package aivastra.nice.interactive.gpufilters
import com.otaliastudios.cameraview.filter.BaseFilter

class SoftFocusFilter : BaseFilter() {
    override fun getFragmentShader(): String = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;

        uniform samplerExternalOES sTexture;
        varying vec2 vTextureCoord;

        vec4 blur(samplerExternalOES image, vec2 uv) {
            float offset = 1.5 / 1080.0;
            vec4 sum = vec4(0.0);
            sum += texture2D(image, uv + vec2(-offset, -offset)) * 0.25;
            sum += texture2D(image, uv + vec2(-offset, offset)) * 0.25;
            sum += texture2D(image, uv + vec2(offset, -offset)) * 0.25;
            sum += texture2D(image, uv + vec2(offset, offset)) * 0.25;
            return sum;
        }

        void main() {
            vec4 original = texture2D(sTexture, vTextureCoord);
            vec4 blurred = blur(sTexture, vTextureCoord);

            // Unsharp mask: sharpen = original + strength * (original - blurred)
            float strength = 0.5;
            vec4 sharpened = original + strength * (original - blurred);

            // Mix sharpened and blurred to keep smoothness but add edge clarity
            vec4 soft = mix(sharpened, blurred, 0.5);

            // Slight desaturation for soft look
            float gray = dot(soft.rgb, vec3(0.299, 0.587, 0.114));
            soft.rgb = mix(soft.rgb, vec3(gray), 0.15);

            gl_FragColor = clamp(soft, 0.0, 1.0);
        }
    """.trimIndent()

    fun getName(): String = "SoftFocus"
}

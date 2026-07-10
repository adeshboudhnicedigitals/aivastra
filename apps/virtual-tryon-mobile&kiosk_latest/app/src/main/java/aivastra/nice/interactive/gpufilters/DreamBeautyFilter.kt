package aivastra.nice.interactive.gpufilters

import com.otaliastudios.cameraview.filter.BaseFilter

class DreamBeautyFilter : BaseFilter() {
    override fun getFragmentShader(): String {
        return """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;

            uniform samplerExternalOES sTexture;
            varying vec2 vTextureCoord;

            // Simple blur function (5-sample box blur)
            vec4 simpleBlur(samplerExternalOES image, vec2 uv, vec2 resolution) {
                float offset = 1.0 / resolution.y; // Adjust for vertical pixel size
                vec4 color = vec4(0.0);
                color += texture2D(image, uv + vec2(-offset, -offset));
                color += texture2D(image, uv + vec2(-offset,  offset));
                color += texture2D(image, uv + vec2( offset, -offset));
                color += texture2D(image, uv + vec2( offset,  offset));
                color += texture2D(image, uv);
                return color / 5.0;
            }

            void main() {
                vec2 resolution = vec2(1080.0, 1920.0); // Change to your preview size for precision

                vec4 original = texture2D(sTexture, vTextureCoord);

                // Smooth image by simple blur
                vec4 blurred = simpleBlur(sTexture, vTextureCoord, resolution);

                // Blend original with blurred (smooth effect)
                float smoothAmount = 0.5;
                vec4 smooth = mix(original, blurred, smoothAmount);

                // Brightness boost
                float brightness = 0.12;
                smooth.rgb += brightness;

                // Contrast adjustment
                float contrast = 1.1;
                smooth.rgb = ((smooth.rgb - 0.5) * contrast) + 0.5;

                // Warm pastel tone
                smooth.r += 0.05;
                smooth.g += 0.03;
                smooth.b += 0.02;

                // Slight gamma correction for natural look
                smooth.rgb = pow(smooth.rgb, vec3(1.02));

                // Soft sharpening: enhance edges by unsharp mask approach
                vec4 highPass = original - blurred + vec4(0.5);
                vec4 sharpened = smooth + (highPass - 0.5) * 0.3;

                gl_FragColor = clamp(sharpened, 0.0, 1.0);
            }
        """.trimIndent()
    }

    fun getName(): String {
        return "Dream Beauty"
    }
}
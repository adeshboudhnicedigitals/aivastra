package aivastra.nice.interactive.gpufilters

import com.otaliastudios.cameraview.filter.BaseFilter

class GlowEnhanceFilter : BaseFilter() {
    override fun getFragmentShader(): String = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;

        uniform samplerExternalOES sTexture;
        varying vec2 vTextureCoord;

        float colorDiff(vec4 a, vec4 b) {
            return length(a.rgb - b.rgb);
        }

        vec4 bilateralBlur(samplerExternalOES image, vec2 uv) {
            float offset = 3.0 / 1080.0;

            vec4 center = texture2D(image, uv);
            vec4 sum = center * 0.4;
            float weightSum = 0.4;

            // Sample neighbors and weight by color similarity
            vec2 offsets[4];
            offsets[0] = vec2(-offset, -offset);
            offsets[1] = vec2(-offset, offset);
            offsets[2] = vec2(offset, -offset);
            offsets[3] = vec2(offset, offset);

            for (int i = 0; i < 4; i++) {
                vec4 sampleColor = texture2D(image, uv + offsets[i]);
                float weight = 1.0 - colorDiff(center, sampleColor);
                weight = max(weight, 0.0);  // clamp negative
                sum += sampleColor * weight * 0.15;
                weightSum += weight * 0.15;
            }
            return sum / weightSum;
        }

        void main() {
            vec4 original = texture2D(sTexture, vTextureCoord);
            vec4 blurred = bilateralBlur(sTexture, vTextureCoord);

            // Unsharp mask step: sharpen = original + strength*(original - blurred)
            float strength = 0.5;
            vec4 sharpened = original + strength * (original - blurred);

            // Mix sharpened with blurred to keep glow effect but sharp details
            vec4 glow = mix(sharpened, blurred, 0.7);

            gl_FragColor = clamp(glow, 0.0, 1.0);
        }
    """.trimIndent()

    fun getName(): String = "GlowEnhance"
}
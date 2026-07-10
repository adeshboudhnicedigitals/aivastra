package aivastra.nice.interactive.gpufilters
import com.otaliastudios.cameraview.filter.BaseFilter

class DreamGlowFilter : BaseFilter() {
    override fun getFragmentShader(): String = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;

        uniform samplerExternalOES sTexture;
        varying vec2 vTextureCoord;

        uniform vec2 resolution;

        // Approximate bilateral blur: smooth but preserve edges by weighting color similarity
        float colorDiff(vec4 a, vec4 b) {
            return length(a.rgb - b.rgb);
        }

        vec4 bilateralBlur(samplerExternalOES image, vec2 uv) {
            float offset = 3.0 / resolution.y; // scale with height for consistency

            vec4 center = texture2D(image, uv);
            vec4 sum = center * 0.4;
            float weightSum = 0.4;

            vec2 offsets[4];
            offsets[0] = vec2(-offset, -offset);
            offsets[1] = vec2(-offset, offset);
            offsets[2] = vec2(offset, -offset);
            offsets[3] = vec2(offset, offset);

            for (int i = 0; i < 4; i++) {
                vec4 sampleColor = texture2D(image, uv + offsets[i]);
                float weight = 1.0 - colorDiff(center, sampleColor);
                weight = max(weight, 0.0);
                sum += sampleColor * weight * 0.15;
                weightSum += weight * 0.15;
            }

            return sum / weightSum;
        }

        // Bloom filter: add glow around bright parts
        vec4 bloom(samplerExternalOES image, vec2 uv) {
            float offset = 5.0 / resolution.y;

            vec4 sum = vec4(0.0);
            sum += texture2D(image, uv + vec2(-offset, 0.0)) * 0.2;
            sum += texture2D(image, uv + vec2(offset, 0.0)) * 0.2;
            sum += texture2D(image, uv + vec2(0.0, -offset)) * 0.2;
            sum += texture2D(image, uv + vec2(0.0, offset)) * 0.2;
            sum += texture2D(image, uv) * 0.2;

            return sum;
        }

        void main() {
            vec2 uv = vTextureCoord;

            vec4 original = texture2D(sTexture, uv);

            // Step 1: Smooth skin using bilateral blur
            vec4 smooth = bilateralBlur(sTexture, uv);

            // Step 2: Bloom glow on bright areas (mix with original)
            vec4 glow = bloom(sTexture, uv);
            vec4 combinedGlow = mix(original, glow, 0.5);

            // Step 3: Mix smooth skin and glow (balance)
            vec4 smoothGlow = mix(combinedGlow, smooth, 0.6);

            // Step 4: Brightness and contrast adjustments
            float brightness = 1.1;
            float contrast = 1.15;
            vec3 color = smoothGlow.rgb * brightness;
            color = ((color - 0.5) * contrast) + 0.5;

            // Step 5: Vignette to focus on center (soft fade at edges)
            vec2 position = (uv - vec2(0.5)) * vec2(resolution.x / resolution.y, 1.0);
            float len = length(position);
            float vignette = smoothstep(0.8, 0.4, len);
            color *= vignette;

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), smoothGlow.a);
        }
    """.trimIndent()

    private var resolutionLocation = -1
    private var viewWidth = 720f
    private var viewHeight = 1280f

    override fun setSize(width: Int, height: Int) {
        super.setSize(width, height)
        viewWidth = width.toFloat()
        viewHeight = height.toFloat()
    }

    override fun onCreate(programHandle: Int) {
        super.onCreate(programHandle)
        resolutionLocation = android.opengl.GLES20.glGetUniformLocation(programHandle, "resolution")
    }

    override fun onPreDraw(timestampUs: Long, transformMatrix: FloatArray) {
        super.onPreDraw(timestampUs, transformMatrix)
        android.opengl.GLES20.glUniform2f(resolutionLocation, viewWidth, viewHeight)
    }

    fun getName(): String = "DreamGlow"
}

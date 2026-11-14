package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName

/**
 * Server-driven "update available" popup. The app sends its own versionCode and the
 * server decides; every field except [show] is absent when [show] is false. Render the
 * text as sent — never hardcode it — so the wording and the on/off switch stay
 * controllable from the admin panel.
 */
data class AppUpdatePromptResponse(
    @SerializedName("show") val show: Boolean = false,
    @SerializedName("latestVersionCode") val latestVersionCode: Int? = null,
    @SerializedName("title") val title: String? = null,
    @SerializedName("message") val message: String? = null,
    @SerializedName("ctaLabel") val ctaLabel: String? = null
)

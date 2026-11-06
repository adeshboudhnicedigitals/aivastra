package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName

/**
 * GET /v1/app/renewal-prompt. The server decides whether to show it (switch, start
 * time, user has no active plan) and owns the copy, so none of that needs an app
 * release. Every field but [show] is absent when [show] is false.
 */
data class RenewalPromptResponse(
    @SerializedName("show") val show: Boolean,
    @SerializedName("blocking") val blocking: Boolean? = null,
    @SerializedName("title") val title: String? = null,
    @SerializedName("message") val message: String? = null,
    @SerializedName("ctaLabel") val ctaLabel: String? = null,
    /** "For any help, contact us" lines; null hides that line. */
    @SerializedName("supportWhatsapp") val supportWhatsapp: String? = null,
    @SerializedName("supportEmail") val supportEmail: String? = null
)

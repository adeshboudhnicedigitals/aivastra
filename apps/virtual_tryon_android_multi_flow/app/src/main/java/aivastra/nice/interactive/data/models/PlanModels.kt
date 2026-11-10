package aivastra.nice.interactive.data.models

import com.google.gson.annotations.SerializedName
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The user's plan as the backend reports it (`unlimitedPlan` in `GET /v1/credits`). The
 * server derives [status] from the live end date, so the app never computes expiry itself.
 * Unknown extra fields in the response are ignored.
 */
data class PlanResponse(
    @SerializedName("balance") val balance: Int = 0,
    @SerializedName("unlimitedPlan") val unlimitedPlan: UserPlan? = null
)

/** `GET /v1/me` — only the purchased credit-plan slug (free, starter, growth, pro, …) is read. */
data class MeTierResponse(
    @SerializedName("tier") val tier: String? = null
)

/**
 * What the home card shows. Mirrors the admin/web rule: a Monthly (unlimited) plan replaces the
 * credit balance; every other user sees their purchased plan and credits as usual.
 */
data class PlanSummary(
    /** Purchased credit plan slug, e.g. "starter"; null if it couldn't be loaded. */
    val tier: String?,
    val balance: Int,
    val monthly: UserPlan?
) {
    /** Monthly shows for any state the web banner shows it: active, expiring, expired, offered. */
    val showMonthly: Boolean
        get() = monthly != null && monthly.status in setOf("active", "expiring_soon", "expired", "offered")

    val tierName: String?
        get() = tier?.takeIf { it.isNotBlank() }
            ?.replace('_', ' ')?.replace('-', ' ')
            ?.split(' ')?.joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }
}

data class UserPlan(
    /** active | expiring_soon | expired | revoked | offered | none */
    @SerializedName("status") val status: String = "none",
    @SerializedName("startAt") val startAt: String? = null,
    @SerializedName("endAt") val endAt: String? = null,
    @SerializedName("daysRemaining") val daysRemaining: Int? = null,
    @SerializedName("durationDays") val durationDays: Int? = null,
    @SerializedName("note") val note: String? = null
) {
    val isInForce: Boolean get() = status == "active" || status == "expiring_soon"

    /** The backend has no plan-name column; the cycle length is what tells plans apart. */
    val label: String
        get() = when (val d = durationDays ?: spanDays()) {
            null -> "Plan"
            in 1..31 -> "Monthly Plan"
            in 80..100 -> "Quarterly Plan"
            in 170..200 -> "Half-Yearly Plan"
            in 350..380 -> "Yearly Plan"
            else -> "$d-Day Plan"
        }

    val statusText: String
        get() = when (status) {
            "active" -> "Active"
            "expiring_soon" -> "Expiring soon"
            "expired" -> "Expired"
            "revoked" -> "Cancelled"
            "offered" -> "Not started"
            else -> "No plan"
        }

    val startDate: String? get() = formatDate(startAt)
    val endDate: String? get() = formatDate(endAt)

    private fun spanDays(): Int? {
        val s = parse(startAt) ?: return null
        val e = parse(endAt) ?: return null
        return ((e.time - s.time) / 86_400_000L).toInt().takeIf { it > 0 }
    }

    private companion object {
        fun parse(iso: String?): Date? {
            if (iso.isNullOrBlank()) return null
            return runCatching {
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
                    .apply { timeZone = TimeZone.getTimeZone("UTC") }
                    .parse(iso.take(19))
            }.getOrNull()
        }

        fun formatDate(iso: String?): String? =
            parse(iso)?.let { SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(it) }
    }
}

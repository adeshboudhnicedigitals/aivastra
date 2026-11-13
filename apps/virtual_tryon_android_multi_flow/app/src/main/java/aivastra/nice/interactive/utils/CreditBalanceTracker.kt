package aivastra.nice.interactive.utils

/** What the result screen should tell the merchant about their credit balance. */
enum class CreditAlert { LOW, EXHAUSTED }

/**
 * Remembers the last balance the app saw so the result screen can tell when a try-on
 * pushed it across a threshold. Crossing (not "is low") keeps the popup from nagging on
 * every result, and a try-on covered by an active monthly plan never moves the balance,
 * so plan holders are never alerted.
 */
object CreditBalanceTracker {
    /** Balance below which crossing downward raises [CreditAlert.LOW]. Matches the web app. */
    const val LOW_CREDIT_THRESHOLD = 30

    @Volatile
    private var lastBalance: Int? = null

    /** Records a balance seen outside the result screen (e.g. the home screen pill). */
    fun record(balance: Int) {
        lastBalance = balance
    }

    /** Records [balance] and returns the alert it triggers against the previous one, if any. */
    fun update(balance: Int): CreditAlert? {
        val alert = evaluate(lastBalance, balance)
        lastBalance = balance
        return alert
    }

    internal fun evaluate(previous: Int?, current: Int): CreditAlert? {
        if (previous == null || current >= previous) return null
        return when {
            current <= 0 -> CreditAlert.EXHAUSTED
            current < LOW_CREDIT_THRESHOLD && previous >= LOW_CREDIT_THRESHOLD -> CreditAlert.LOW
            else -> null
        }
    }
}

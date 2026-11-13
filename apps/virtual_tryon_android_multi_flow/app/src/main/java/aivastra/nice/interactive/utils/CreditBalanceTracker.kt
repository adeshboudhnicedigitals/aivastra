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

    /** Level last shown to the user this process, so the home screen doesn't repeat it on every visit. */
    @Volatile
    private var announced: CreditAlert? = null

    /** Records [balance] and returns the alert it triggers against the previous one, if any. */
    fun update(balance: Int): CreditAlert? {
        val alert = evaluate(lastBalance, balance)
        lastBalance = balance
        if (alert != null) announced = alert else if (levelFor(balance) == null) announced = null
        return alert
    }

    /**
     * For the home screen: a user who is *already* low or out of credits never crosses a
     * threshold, so [update] would stay silent for them forever. Returns the alert once per
     * level per app run (low, then again if it worsens to exhausted); null while the balance is
     * healthy. Callers must not call this for a merchant whose monthly plan is in force.
     */
    fun alertOnOpen(balance: Int): CreditAlert? {
        lastBalance = balance
        val level = levelFor(balance)
        if (level == null) {
            announced = null
            return null
        }
        if (announced == level) return null
        announced = level
        return level
    }

    internal fun levelFor(balance: Int): CreditAlert? = when {
        balance <= 0 -> CreditAlert.EXHAUSTED
        balance < LOW_CREDIT_THRESHOLD -> CreditAlert.LOW
        else -> null
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

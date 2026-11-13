package aivastra.nice.interactive

import aivastra.nice.interactive.utils.CreditAlert
import aivastra.nice.interactive.utils.CreditBalanceTracker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CreditBalanceTrackerTest {
    @Test
    fun noAlertWithoutAPreviousBalance() {
        assertNull(CreditBalanceTracker.evaluate(null, 5))
    }

    @Test
    fun lowAlertWhenBalanceCrossesBelowThreshold() {
        assertEquals(CreditAlert.LOW, CreditBalanceTracker.evaluate(35, 20))
        assertEquals(CreditAlert.LOW, CreditBalanceTracker.evaluate(30, 29))
    }

    @Test
    fun noRepeatAlertWhileAlreadyBelowThreshold() {
        assertNull(CreditBalanceTracker.evaluate(20, 10))
    }

    @Test
    fun exhaustedAlertWhenBalanceReachesZero() {
        assertEquals(CreditAlert.EXHAUSTED, CreditBalanceTracker.evaluate(10, 0))
        assertEquals(CreditAlert.EXHAUSTED, CreditBalanceTracker.evaluate(50, 0))
    }

    @Test
    fun noAlertWhenBalanceUnchangedOrRises() {
        assertNull(CreditBalanceTracker.evaluate(0, 0))
        assertNull(CreditBalanceTracker.evaluate(10, 100))
        assertNull(CreditBalanceTracker.evaluate(40, 40))
    }
}

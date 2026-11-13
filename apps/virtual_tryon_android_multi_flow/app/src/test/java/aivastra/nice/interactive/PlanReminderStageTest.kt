package aivastra.nice.interactive

import aivastra.nice.interactive.data.models.PlanReminderStage
import aivastra.nice.interactive.data.models.UserPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanReminderStageTest {
    private fun plan(status: String, days: Int?) = UserPlan(status = status, daysRemaining = days)

    @Test
    fun sevenDayWindow() {
        assertEquals(PlanReminderStage.SEVEN_DAY, plan("active", 7).reminderStage)
        assertEquals(PlanReminderStage.SEVEN_DAY, plan("active", 4).reminderStage)
    }

    @Test
    fun threeDayWindow() {
        assertEquals(PlanReminderStage.THREE_DAY, plan("expiring_soon", 3).reminderStage)
        assertEquals(PlanReminderStage.THREE_DAY, plan("expiring_soon", 1).reminderStage)
    }

    @Test
    fun noReminderOutsideWindowOrWhenNotInForce() {
        assertNull(plan("active", 8).reminderStage)
        assertNull(plan("active", null).reminderStage)
        assertNull(plan("expired", 0).reminderStage)
        assertNull(plan("revoked", 2).reminderStage)
        assertNull(plan("offered", 5).reminderStage)
    }
}

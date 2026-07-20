package aivastra.nice.aivastraadmin

import aivastra.nice.aivastraadmin.viewmodels.isTerminalGenerateStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PollStatusTest {
    @Test
    fun `completed failed and cancelled are terminal`() {
        assertTrue(isTerminalGenerateStatus("COMPLETED"))
        assertTrue(isTerminalGenerateStatus("FAILED"))
        assertTrue(isTerminalGenerateStatus("CANCELLED"))
    }

    @Test
    fun `queued and processing are not terminal`() {
        assertFalse(isTerminalGenerateStatus("QUEUED"))
        assertFalse(isTerminalGenerateStatus("PROCESSING"))
        assertFalse(isTerminalGenerateStatus(""))
    }
}

package aivastra.nice.interactive.device

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class EventQueueCoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun queue(max: Int = 5_000) = EventQueueCore(File(tmp.root, "events.jsonl"), max)
    private fun ev(name: String = "item_viewed") = QueuedEvent(event = name)

    @Test
    fun `events survive a new queue instance on the same file (process death)`() {
        val a = ev()
        queue().append(a)
        val reopened = queue()
        assertEquals(listOf(a.id), reopened.peek(10).map { it.id })
    }

    @Test
    fun `peek returns oldest first and does not remove`() {
        val q = queue()
        val events = (1..5).map { ev("e$it") }
        events.forEach(q::append)
        assertEquals(events.take(3).map { it.id }, q.peek(3).map { it.id })
        assertEquals(5, q.size())
    }

    @Test
    fun `a delivered batch is removed and the next batch is the rest`() = runBlocking {
        val q = queue()
        val events = (1..150).map { ev() }
        events.forEach(q::append)
        val sent = mutableListOf<Int>()
        q.flushOnce(100) { sent += it.size; UploadOutcome.DONE }
        q.flushOnce(100) { sent += it.size; UploadOutcome.DONE }
        assertEquals(listOf(100, 50), sent)
        assertEquals(0, q.size())
        assertNull(q.flushOnce(100) { error("nothing to send") })
    }

    @Test
    fun `a retryable failure keeps the batch with the same ids, so a resend dedupes server-side`() = runBlocking {
        val q = queue()
        val e = ev()
        q.append(e)
        q.flushOnce { UploadOutcome.RETRY }
        q.flushOnce { UploadOutcome.UNAUTHORIZED }
        assertEquals(listOf(e.id), q.peek(10).map { it.id })
    }

    @Test
    fun `an invalid batch is discarded rather than retried forever`() = runBlocking {
        val q = queue()
        q.append(ev())
        assertEquals(UploadOutcome.INVALID, q.flushOnce { UploadOutcome.INVALID })
        assertEquals(0, q.size())
    }

    @Test
    fun `events appended during an upload are not lost`() = runBlocking {
        val q = queue()
        val first = ev()
        q.append(first)
        val late = ev()
        q.flushOnce { batch ->
            q.append(late)
            assertEquals(listOf(first.id), batch.map { it.id })
            UploadOutcome.DONE
        }
        assertEquals(listOf(late.id), q.peek(10).map { it.id })
    }

    @Test
    fun `the cap drops the oldest events`() {
        val q = queue(max = 3)
        val events = (1..5).map { ev("e$it") }
        events.forEach(q::append)
        assertEquals(events.takeLast(3).map { it.id }, q.peek(10).map { it.id })
    }

    @Test
    fun `a corrupt line is skipped and cleaned up, the rest still upload`() = runBlocking {
        val file = File(tmp.root, "events.jsonl")
        val q = EventQueueCore(file)
        val good = ev()
        q.append(good)
        file.appendText("{not json\n")
        assertEquals(listOf(good.id), q.peek(10).map { it.id })
        q.flushOnce { UploadOutcome.DONE }
        assertEquals("", file.readText())
    }
}

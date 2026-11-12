package aivastra.nice.interactive.device

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * One tablet analytics event, as POST /v1/device/events takes it. `id` is minted once, when the
 * event happens, and is what the server dedupes on, so a retried or replayed upload can never
 * count twice (spec §9). Merchant, branch and device are never sent: the server takes them from
 * the device token.
 */
data class QueuedEvent(
    @SerializedName("id") val id: String = UUID.randomUUID().toString(),
    @SerializedName("event") val event: String,
    @SerializedName("occurredAt") val occurredAt: String = Instant.now().toString(),
    @SerializedName("sessionId") val sessionId: String? = null,
    @SerializedName("catalogItemId") val catalogItemId: String? = null,
    @SerializedName("props") val props: Map<String, Any>? = null,
)

/** What the uploader learned from one POST, reduced to what the queue must do next. */
enum class UploadOutcome {
    /** 200: every event in the batch reached a final state (accepted, duplicate, dropped or rejected). */
    DONE,
    /** 400: the batch itself is invalid. Retrying cannot fix it, so it is discarded. */
    INVALID,
    /** 401: the device is no longer paired. Keep the events; nothing can be sent. */
    UNAUTHORIZED,
    /** 429, 5xx, no network: keep the events and try again later. */
    RETRY,
}

/**
 * File-backed FIFO of events waiting to be uploaded: one JSON object per line. Pure JVM (no
 * Android types) so it is unit-tested directly. Survives process death, so events from a tablet
 * that was offline all afternoon still arrive (the server accepts up to 7 days late).
 */
class EventQueueCore(
    private val file: File,
    /** Oldest events are dropped beyond this, so a tablet offline for weeks cannot fill its disk. */
    private val maxEvents: Int = 5_000,
) {
    private val gson = Gson()
    private val lock = Any()

    fun append(event: QueuedEvent) = synchronized(lock) {
        val lines = readLines()
        val kept = if (lines.size >= maxEvents) lines.drop(lines.size - maxEvents + 1) else lines
        if (kept.size == lines.size) {
            file.appendText(gson.toJson(event) + "\n")
        } else {
            write(kept + gson.toJson(event))
        }
    }

    fun size(): Int = synchronized(lock) { readLines().size }

    /** The oldest `max` events, without removing them. Unreadable lines are skipped. */
    fun peek(max: Int): List<QueuedEvent> = synchronized(lock) {
        readLines().asSequence().mapNotNull { parse(it) }.take(max).toList()
    }

    /** Removes exactly these events (by id), plus any line that no longer parses. */
    fun remove(ids: Set<String>) = synchronized(lock) {
        write(readLines().filter { line -> parse(line)?.let { it.id !in ids } ?: false })
    }

    /**
     * Uploads the oldest batch with [send] and applies the outcome. Returns that outcome, or null
     * when there was nothing to send.
     */
    suspend fun flushOnce(batchSize: Int = 100, send: suspend (List<QueuedEvent>) -> UploadOutcome): UploadOutcome? {
        val batch = peek(batchSize)
        if (batch.isEmpty()) return null
        val outcome = send(batch)
        if (outcome == UploadOutcome.DONE || outcome == UploadOutcome.INVALID) {
            remove(batch.map { it.id }.toSet())
        }
        return outcome
    }

    private fun parse(line: String): QueuedEvent? =
        try {
            gson.fromJson(line, QueuedEvent::class.java)?.takeIf { it.id.isNotBlank() && it.event.isNotBlank() }
        } catch (_: Exception) {
            null
        }

    private fun readLines(): List<String> =
        if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()

    private fun write(lines: List<String>) {
        // Write-then-rename, so a crash mid-write leaves the old queue, never half a file.
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(if (lines.isEmpty()) "" else lines.joinToString("\n", postfix = "\n"))
        if (!tmp.renameTo(file)) {
            file.writeText(tmp.readText())
            tmp.delete()
        }
    }
}

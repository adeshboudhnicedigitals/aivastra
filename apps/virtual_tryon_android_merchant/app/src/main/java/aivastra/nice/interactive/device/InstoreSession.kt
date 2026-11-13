package aivastra.nice.interactive.device

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.utils.CrashReporter
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.util.UUID

/**
 * The shopper visit in progress on this tablet (HLD §5.2–5.3): started when a category is
 * picked, ended when the app returns to the home screen. Kiosk unless a staff member is signed
 * in, in which case it is that staff member's assisted session.
 *
 * The server also ends sessions idle for 10 minutes (session sweeper); a try-on against such a
 * session gets 409 SESSION_ENDED, and [restartAfterServerEnd] opens a fresh one.
 */
object InstoreSession {
    sealed interface StartResult {
        data class Started(val id: String, val mode: String) : StartResult
        /** Assisted start refused: the staff token expired or the staff member is not of this branch. */
        data class StaffRejected(val message: String) : StartResult
        data class Failed(val message: String) : StartResult
    }

    private val mutex = Mutex()

    @Volatile var id: String? = null
        private set
    @Volatile var mode: String? = null
        private set

    // One key per intended session, reused across retries of that start: a start whose response
    // was lost on the network is replayed by the server instead of opening a second session.
    private var pendingKey: String? = null

    private val api get() = ApiClient.deviceApi

    suspend fun start(): StartResult = mutex.withLock {
        id?.let { return@withLock StartResult.Started(it, mode ?: "kiosk") }
        val assisted = StaffSession.isSignedIn
        if (assisted && StaffSession.validToken() == null) {
            return@withLock StartResult.StaffRejected("Staff sign-in expired. Please sign in again.")
        }
        val key = pendingKey ?: UUID.randomUUID().toString().also { pendingKey = it }
        val wanted = if (assisted) "assisted" else "kiosk"
        try {
            val res = api.startSession(key, StartSessionRequest(wanted))
            val body = res.body()
            when {
                res.isSuccessful && body != null -> {
                    id = body.id
                    mode = body.mode
                    pendingKey = null
                    EventReporter.sessionStarted()
                    StartResult.Started(body.id, body.mode)
                }
                res.code() == 401 || res.code() == 403 -> {
                    pendingKey = null
                    if (assisted) StartResult.StaffRejected("This staff account can't start a session on this tablet.")
                    else StartResult.Failed("This tablet is not recognised. Pair it again.")
                }
                else -> StartResult.Failed("Could not start the session (${res.code()}).")
            }
        } catch (e: IOException) {
            StartResult.Failed("No connection. Check the network and try again.")
        }
    }

    /** Ends the current session, if any. Best effort: the server's idle sweeper is the backstop. */
    suspend fun end() = mutex.withLock {
        val current = id ?: return@withLock
        id = null
        mode = null
        try {
            api.endSession(current)
        } catch (e: Exception) {
            CrashReporter.recordException(e, "InstoreSession.end")
        }
        EventReporter.flushSoon()
    }

    /** The server ended our session (idle sweeper): drop it locally and open a new one. */
    suspend fun restartAfterServerEnd(): StartResult {
        mutex.withLock {
            id = null
            mode = null
        }
        return start()
    }

    /** Device unpaired: forget without calling the server (the token is already gone). */
    fun forget() {
        id = null
        mode = null
        pendingKey = null
    }
}

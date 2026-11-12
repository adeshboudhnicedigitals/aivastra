package aivastra.nice.interactive.ui.components

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.device.InstoreSession
import aivastra.nice.interactive.device.SessionItemRequest
import aivastra.nice.interactive.device.StaffSession
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * What this visit has recorded per catalogue item, so the buttons survive navigating between
 * result screens. Keyed by session id + item, so a new visit starts clean.
 */
object SessionItemMarks {
    data class Mark(val wishlisted: Boolean = false, val soldItemId: String? = null)

    private val marks = mutableStateMapOf<String, Mark>()

    fun get(sessionId: String?, itemId: String): Mark = marks["$sessionId:$itemId"] ?: Mark()

    fun set(sessionId: String, itemId: String, mark: Mark) {
        marks["$sessionId:$itemId"] = mark
    }
}

/**
 * Wishlist (any session) and Sold (assisted sessions only, HLD §5.3) for one garment's result.
 * Sold can be undone by the seller from here; after 24 hours, or for anyone else, only the
 * merchant admin can void it (server-enforced).
 */
@Composable
fun SessionItemBar(catalogItemId: String, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val sessionId = InstoreSession.id
    val mark = SessionItemMarks.get(sessionId, catalogItemId)
    val assisted = InstoreSession.mode == "assisted"
    val api = ApiClient.deviceApi

    fun run(block: suspend (String) -> Unit) {
        if (busy) return
        busy = true
        message = null
        scope.launch {
            try {
                val sid = when (val s = InstoreSession.start()) {
                    is InstoreSession.StartResult.Started -> s.id
                    is InstoreSession.StartResult.StaffRejected -> { message = s.message; null }
                    is InstoreSession.StartResult.Failed -> { message = s.message; null }
                }
                if (sid != null) block(sid)
            } catch (_: IOException) {
                message = "No connection."
            } finally {
                busy = false
            }
        }
    }

    Column(modifier = modifier, horizontalAlignment = Alignment.End) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(
                label = if (mark.wishlisted) "♥ Wishlisted" else "♡ Wishlist",
                active = mark.wishlisted,
                onClick = {
                    if (!mark.wishlisted) run { sid ->
                        val res = api.addItem(sid, SessionItemRequest(catalogItemId, "wishlisted"))
                        if (res.isSuccessful) SessionItemMarks.set(sid, catalogItemId, mark.copy(wishlisted = true))
                        else message = "Couldn't save (${res.code()})."
                    }
                }
            )
            if (assisted) {
                val soldId = mark.soldItemId
                Pill(
                    label = if (soldId == null) "Mark sold" else "Undo sale",
                    active = soldId != null,
                    onClick = {
                        run { sid ->
                            if (soldId == null) {
                                val res = api.addItem(sid, SessionItemRequest(catalogItemId, "sold"))
                                val body = res.body()
                                if (res.isSuccessful && body != null) {
                                    SessionItemMarks.set(sid, catalogItemId, mark.copy(soldItemId = body.id))
                                } else {
                                    message = "Couldn't mark sold (${res.code()})."
                                }
                            } else {
                                if (StaffSession.validToken() == null) {
                                    message = "Sign in again to undo this sale."
                                    return@run
                                }
                                val res = api.undoItem(sid, soldId)
                                if (res.isSuccessful) SessionItemMarks.set(sid, catalogItemId, mark.copy(soldItemId = null))
                                else message = if (res.code() == 403) "Only the seller can undo, within 24 hours." else "Couldn't undo (${res.code()})."
                            }
                        }
                    }
                )
            }
        }
        message?.let {
            Text(it, color = Color(0xFFFF6A4D), fontSize = 11.sp, fontFamily = PoppinsFamily, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun Pill(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        fontFamily = PoppinsFamily,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (active) Color(0xFF9B5100) else Color.Black.copy(alpha = 0.55f))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    )
}

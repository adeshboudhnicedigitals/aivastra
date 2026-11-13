package aivastra.nice.interactive.ui.components

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.device.CartLineAddRequest
import aivastra.nice.interactive.device.CartView
import aivastra.nice.interactive.device.DeviceVariant
import aivastra.nice.interactive.device.DeviceVariantsResponse
import aivastra.nice.interactive.device.EventReporter
import aivastra.nice.interactive.device.InstoreSession
import aivastra.nice.interactive.device.StaffSession
import aivastra.nice.interactive.ui.screens.QrCodeImage
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.oned.Code128Writer
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.Locale
import java.util.UUID

// CRM phase 3 on the tablet (spec §6.1–6.2). Rules (stock, who may bill) live on the server;
// these screens only render what it says and send what the shopper or staff tapped.

private fun rupees(paise: Int): String = "₹" + String.format(Locale.ENGLISH, "%,d", paise / 100)

/** A CODE-128 barcode the cashier's scanner reads off the screen (plan P1). */
@Composable
fun BarcodeImage(content: String, modifier: Modifier = Modifier) {
    val bitmap = remember(content) {
        runCatching {
            val w = 600
            val h = 160
            val matrix = Code128Writer().encode(content, BarcodeFormat.CODE_128, w, h)
            android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.RGB_565).apply {
                for (y in 0 until h) for (x in 0 until w) {
                    setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
                }
            }.asImageBitmap()
        }.getOrNull()
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = "Barcode $content",
            contentScale = ContentScale.Fit,
            filterQuality = FilterQuality.None,
            modifier = modifier.background(Color.White).padding(6.dp)
        )
    }
}

/** Sizes of one garment with this branch's availability; an available size goes in the cart. */
@Composable
fun AddToCartDialog(catalogItemId: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<DeviceVariantsResponse?>(null) }
    var picked by remember { mutableStateOf<DeviceVariant?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(catalogItemId) {
        data = try {
            ApiClient.deviceApi.variants(catalogItemId).body()
        } catch (_: IOException) {
            null
        }
        if (data == null) message = "Couldn't load sizes. Check the connection."
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a size", fontFamily = PoppinsFamily) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                val variants = data?.variants.orEmpty()
                if (data != null && variants.isEmpty()) {
                    Text("No sizes have been added for this item yet.", fontFamily = PoppinsFamily)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    variants.forEach { v ->
                        val out = v.status == "out"
                        Text(
                            v.size + if (v.colour.isNotBlank()) " · ${v.colour}" else "",
                            fontFamily = PoppinsFamily,
                            fontWeight = FontWeight.SemiBold,
                            color = if (out) Color.Gray else Color.Black,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .border(1.dp, if (picked?.id == v.id) Color(0xFF9B5100) else Color.LightGray, RoundedCornerShape(8.dp))
                                .clickable {
                                    picked = v
                                    message = null
                                    if (out) {
                                        EventReporter.oosViewed(catalogItemId, v.id)
                                        if (v.otherBranches.isNotEmpty()) EventReporter.otherBranchShown(catalogItemId, v.otherBranches.size)
                                    }
                                }
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        )
                    }
                }
                val p = picked
                if (p != null) {
                    Spacer(Modifier.height(12.dp))
                    Text("${p.size}: ${rupees(p.pricePaise)}" + when (p.status) {
                        "low" -> " · only a few left"
                        "out" -> " · out of stock here"
                        else -> ""
                    }, fontFamily = PoppinsFamily)
                    if (p.status == "out") {
                        if (p.otherBranches.isNotEmpty()) {
                            Text(
                                "Available at " + p.otherBranches.joinToString(", ") { it.name },
                                fontFamily = PoppinsFamily,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        data?.buyOnlineUrl?.let { url ->
                            Spacer(Modifier.height(8.dp))
                            Text("Or buy online: scan with your phone", fontFamily = PoppinsFamily)
                            // Shown, not clicked: a scan on the shopper's phone is invisible to us.
                            LaunchedEffect(p.id) { EventReporter.qrShown("buy_online") }
                            QrCodeImage(content = url, modifier = Modifier.size(160.dp))
                        }
                    }
                }
                message?.let { Text(it, color = Color(0xFFB3261E), fontFamily = PoppinsFamily) }
            }
        },
        confirmButton = {
            val p = picked
            TextButton(
                enabled = !busy && p != null && p.status != "out",
                onClick = {
                    val v = p ?: return@TextButton
                    busy = true
                    scope.launch {
                        try {
                            val sid = when (val s = InstoreSession.start()) {
                                is InstoreSession.StartResult.Started -> s.id
                                is InstoreSession.StartResult.StaffRejected -> { message = s.message; null }
                                is InstoreSession.StartResult.Failed -> { message = s.message; null }
                            } ?: return@launch
                            val res = ApiClient.deviceApi.addToCart(sid, UUID.randomUUID().toString(), CartLineAddRequest(v.id))
                            if (res.isSuccessful) onDismiss()
                            else message = if (res.code() == 409) "Out of stock here." else "Couldn't add (${res.code()})."
                        } catch (_: IOException) {
                            message = "No connection."
                        } finally {
                            busy = false
                        }
                    }
                }
            ) { Text(if (busy) "Adding…" else "Add to cart") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

/**
 * The cart: what the cashier scans (one barcode per line) and the cart code to type at the
 * counter. In an assisted session the signed-in staff member can mark it billed here.
 */
@Composable
fun CartDialog(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var cart by remember { mutableStateOf<CartView?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val sid = InstoreSession.id
    val assisted = InstoreSession.mode == "assisted"

    LaunchedEffect(sid) {
        if (sid != null) {
            cart = try {
                ApiClient.deviceApi.cart(sid).body()?.cart
            } catch (_: IOException) {
                message = "No connection."
                null
            }
        }
        loaded = true
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Cart", fontFamily = PoppinsFamily) },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                val c = cart
                when {
                    !loaded -> Text("Loading…", fontFamily = PoppinsFamily)
                    c == null || c.lines.isEmpty() -> Text("The cart is empty.", fontFamily = PoppinsFamily)
                    else -> {
                        Text("Show this at the counter", fontFamily = PoppinsFamily)
                        Text(c.cartCode, fontSize = 28.sp, fontWeight = FontWeight.Bold, fontFamily = PoppinsFamily)
                        Spacer(Modifier.height(8.dp))
                        c.lines.forEach { l ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                    Text("${l.label} · ${l.size} × ${l.quantity}", fontFamily = PoppinsFamily, fontWeight = FontWeight.SemiBold)
                                    Text(rupees(l.unitPricePaise * l.quantity), fontFamily = PoppinsFamily)
                                }
                                if (l.billed) {
                                    Text("Billed", color = Color(0xFF2E7D32), fontFamily = PoppinsFamily)
                                } else {
                                    l.barcode?.let { BarcodeImage(it, Modifier.fillMaxWidth().height(70.dp)) }
                                        ?: Text("SKU ${l.sku ?: "—"}", fontFamily = PoppinsFamily)
                                    Text(
                                        "Remove",
                                        color = Color(0xFFB3261E),
                                        fontFamily = PoppinsFamily,
                                        modifier = Modifier.clickable(enabled = !busy && sid != null) {
                                            busy = true
                                            scope.launch {
                                                try {
                                                    ApiClient.deviceApi.removeFromCart(sid!!, l.id).body()?.let { cart = it }
                                                } catch (_: IOException) {
                                                    message = "No connection."
                                                } finally {
                                                    busy = false
                                                }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                        Text("Total ${rupees(c.totalPaise)}", fontWeight = FontWeight.Bold, fontFamily = PoppinsFamily)
                    }
                }
                message?.let { Text(it, color = Color(0xFFB3261E), fontFamily = PoppinsFamily) }
            }
        },
        confirmButton = {
            val c = cart
            if (assisted && c != null && c.lines.any { !it.billed }) {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        if (StaffSession.validToken() == null) {
                            message = "Sign in again to bill this cart."
                            return@TextButton
                        }
                        busy = true
                        scope.launch {
                            try {
                                val res = ApiClient.deviceApi.billCart(sid!!)
                                if (res.isSuccessful) cart = res.body() else message = "Couldn't bill (${res.code()})."
                            } catch (_: IOException) {
                                message = "No connection."
                            } finally {
                                busy = false
                            }
                        }
                    }
                ) { Text(if (busy) "Billing…" else "Mark billed") }
            } else {
                TextButton(onClick = onDismiss) { Text("Close") }
            }
        },
        dismissButton = if (assisted) ({ TextButton(onClick = onDismiss) { Text("Close") } }) else null
    )
}

/** The cart pill shown on the result and download screens. */
@Composable
fun CartPill(modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Text(
        "Cart",
        color = Color.White,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        fontFamily = PoppinsFamily,
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Color.Black.copy(alpha = 0.55f))
            .clickable { open = true }
            .padding(horizontal = 14.dp, vertical = 8.dp)
    )
    if (open) CartDialog(onDismiss = { open = false })
}

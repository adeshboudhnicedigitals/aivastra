package aivastra.nice.interactive.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import kotlin.math.sin
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import aivastra.nice.interactive.ui.components.ResultLogoBadge
import aivastra.nice.interactive.ui.components.AppToast
import aivastra.nice.interactive.ui.components.ExitSessionDialog
import aivastra.nice.interactive.ui.components.ToastType
import aivastra.nice.interactive.ui.components.ZoomableImageGallery
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import aivastra.nice.interactive.viewmodels.MultiTryOnItemState
import aivastra.nice.interactive.viewmodels.MultiTryOnItemStatus

/**
 * Shows every garment picked in a multi-select batch as its own tile, flipping from a
 * generating animation to the finished image independently as each job completes — the
 * customer can swipe through whatever's already ready without waiting for the slowest one.
 * There's no cancel-generation API (same limitation as the single-garment
 * [TryOnProcessingPage]), so the hard back/gesture exit is blocked with a toast while
 * anything is still generating; the explicit "Download All" / "Add More Looks" actions are
 * allowed through at any time since the batch keeps generating in the background regardless
 * of which screen is on top. "Add More Looks" never navigates away — it opens [AddGarmentsDialog]
 * over this same grid, and whatever's picked is simply added as a new tile here.
 */
@Composable
fun MultiTryOnResultsPage(
    items: List<MultiTryOnItemState>,
    category: String,
    onRetryItem: (String) -> Unit,
    onDownloadAll: () -> Unit,
    onAddGarments: (List<CatalogProduct>) -> Unit,
    onGoHome: () -> Unit,
    onGoToDownloads: () -> Unit,
    onRetake: () -> Unit,
    modifier: Modifier = Modifier,
    /** Device mode: per-result actions (Wishlist / Sold) drawn over each finished tile. */
    tileActions: @Composable BoxScope.(MultiTryOnItemState) -> Unit = {}
) {
    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    val isAnyInProgress = items.any {
        it.status == MultiTryOnItemStatus.QUEUED || it.status == MultiTryOnItemStatus.PROCESSING
    }
    val completedCount = items.count { it.status == MultiTryOnItemStatus.COMPLETED }

    var showLeaveWarningToast by remember { mutableStateOf(false) }
    var showExitDialog by remember { mutableStateOf(false) }
    var showAddGarmentsDialog by remember { mutableStateOf(false) }
    var galleryStartIndex by remember { mutableStateOf<Int?>(null) }

    // The customer photo's upload binding lives only ~10 minutes server-side, and every look in
    // this batch (and every Retry) reuses that same photo key. Once it lapses, job creation is
    // rejected with "upload session expired or not owned" and Retry can never succeed, so tell
    // the customer plainly and offer a way out instead of leaving a silently failing tile.
    // Re-armed on each fresh expiry failure (a Retry that fails again re-shows it).
    val photoExpired = items.any {
        it.status == MultiTryOnItemStatus.FAILED && isPhotoSessionExpired(it.errorMessage)
    }
    var photoExpiredDismissed by remember { mutableStateOf(false) }
    LaunchedEffect(photoExpired) { if (photoExpired) photoExpiredDismissed = false }

    val attemptLeave: () -> Unit = {
        if (isAnyInProgress) showLeaveWarningToast = true else showExitDialog = true
    }
    BackHandler(onBack = attemptLeave)

    // Low-credit / out-of-credit heads-up. Each finished garment deducts credits, so re-check
    // as the completed count grows; the tracker only alerts when a threshold is crossed.

    // Newest generation first. The view model appends in request order, so the grid and the
    // gallery (swipe order) both read from this reversed copy to stay in step with each other.
    val displayItems = remember(items) { items.asReversed() }

    // Built together so completedUrls and completedJobIds stay index-aligned for the gallery QR.
    val completedWithUrl = remember(displayItems) {
        displayItems.filter { it.status == MultiTryOnItemStatus.COMPLETED && it.resultUrl != null }
    }
    val completedUrls = remember(completedWithUrl) { completedWithUrl.mapNotNull { it.resultUrl } }
    val completedJobIds = remember(completedWithUrl) { completedWithUrl.map { it.jobId } }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF080808))
    ) {
        Image(
            painter = painterResource(R.drawable.new_app_bg),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = sdp(R.dimen._18sdp),
                    end = sdp(R.dimen._18sdp),
                    top = statusBarH + sdp(R.dimen._10sdp),
                    bottom = sdp(R.dimen._12sdp) + navBarH
                )
        ) {
            // ── Top Bar ──────────────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(sdp(R.dimen._38sdp))
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = attemptLeave
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Home,
                        contentDescription = "Home",
                        tint = Color.White,
                        modifier = Modifier.size(sdp(R.dimen._20sdp))
                    )
                }
                AppHeaderLogo()
            }

            Spacer(Modifier.height(sdp(R.dimen._14sdp)))

            // ── Live Progress (no page title — the grid speaks for itself) ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isAnyInProgress) {
                    CircularProgressIndicator(
                        color = Color(0xFFE59B17),
                        strokeWidth = sdp(R.dimen._2sdp),
                        modifier = Modifier.size(sdp(R.dimen._14sdp))
                    )
                    Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                }
                Text(
                    text = "$completedCount of ${items.size} ready" +
                        if (isAnyInProgress) " — tap a finished look to view it" else "",
                    color = Color.White.copy(alpha = 0.76f),
                    fontSize = ssp(R.dimen._12ssp),
                    fontWeight = FontWeight.Medium,
                    fontFamily = PoppinsFamily
                )
            }

            Spacer(Modifier.height(sdp(R.dimen._14sdp)))

            // ── Grid of Garment Tiles ────────────────────────────────────
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(vertical = sdp(R.dimen._8sdp)),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                verticalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                items(displayItems, key = { it.product.id }) { item ->
                    MultiTryOnTile(
                        item = item,
                        onClick = {
                            val url = item.resultUrl
                            if (url != null) {
                                val index = completedUrls.indexOf(url)
                                if (index >= 0) galleryStartIndex = index
                            }
                        },
                        onRetry = { onRetryItem(item.product.id) },
                        actions = tileActions
                    )
                }
            }

            Spacer(Modifier.height(sdp(R.dimen._12sdp)))

            // ── Bottom Action Bar ────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._bottom_action_button_height))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(if (completedCount > 0) Color.White else Color.White.copy(alpha = 0.3f))
                        .clickable(enabled = completedCount > 0, onClick = onDownloadAll),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Download All",
                        color = Color(0xFF7E3D00),
                        fontSize = ssp(R.dimen._15ssp),
                        fontWeight = FontWeight.Bold,
                        fontFamily = PoppinsFamily
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._bottom_action_button_height))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
                        .clickable(onClick = { showAddGarmentsDialog = true }),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Add More Looks",
                        color = Color.White,
                        fontSize = ssp(R.dimen._15ssp),
                        fontWeight = FontWeight.Bold,
                        fontFamily = PoppinsFamily
                    )
                }
            }
        }

        // Leave-during-generation warning, same rationale as TryOnProcessingPage: there's no
        // cancel-generation API, so a hard back/gesture exit is blocked rather than silently
        // abandoning jobs the customer has no way back to.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(bottom = navBarH + sdp(R.dimen._12sdp))
        ) {
            AppToast(
                visible = showLeaveWarningToast,
                message = "Please wait — some looks are still generating.",
                type = ToastType.WARNING,
                autoDismissMs = 3000L,
                onDismiss = { showLeaveWarningToast = false }
            )
        }

        val startIndex = galleryStartIndex
        if (startIndex != null && completedUrls.isNotEmpty()) {
            ZoomableImageGallery(
                images = completedUrls,
                jobIds = completedJobIds,
                currentIndex = startIndex.coerceIn(0, completedUrls.lastIndex),
                onIndexChange = { galleryStartIndex = it },
                onClose = { galleryStartIndex = null },
                statusBarH = statusBarH,
                navBarH = navBarH
            )
        }

        if (showExitDialog) {
            ExitSessionDialog(
                onGoHome = { showExitDialog = false; onGoHome() },
                onGoToDownloads = { showExitDialog = false; onGoToDownloads() },
                onRetake = { showExitDialog = false; onRetake() },
                onDismiss = { showExitDialog = false }
            )
        }

        if (photoExpired && !photoExpiredDismissed && !showExitDialog) {
            ExitSessionDialog(
                title = "Photo Session Expired",
                message = "Your photo upload session expired, so new looks can't be generated. " +
                    "Retake your photo to continue, or go home" +
                    if (completedCount > 0) " or download the looks that are ready." else ".",
                onGoHome = { photoExpiredDismissed = true; onGoHome() },
                onGoToDownloads = if (completedCount > 0) {
                    { photoExpiredDismissed = true; onGoToDownloads() }
                } else null,
                onRetake = { photoExpiredDismissed = true; onRetake() },
                onDismiss = { photoExpiredDismissed = true }
            )
        }

        if (showAddGarmentsDialog) {
            AddGarmentsDialog(
                category = category,
                generatedItems = items,
                onDismiss = { showAddGarmentsDialog = false },
                onGenerate = onAddGarments
            )
        }
    }
}

/** Matches the API's 403 "upload session expired or not owned" for a lapsed customer-photo key. */
private fun isPhotoSessionExpired(errorMessage: String?): Boolean {
    val msg = errorMessage.orEmpty().lowercase()
    return msg.contains("upload session expired") || msg.contains("not owned")
}

@Composable
private fun MultiTryOnTile(
    item: MultiTryOnItemState,
    onClick: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable BoxScope.(MultiTryOnItemState) -> Unit = {}
) {
    val shape = RoundedCornerShape(sdp(R.dimen._12sdp))
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(0.78f)
            .clip(shape)
            .background(Color(0xFF161514))
            .border(sdp(R.dimen._1sdp), Color(0xFF3B2A18), shape)
            .then(
                if (item.status == MultiTryOnItemStatus.COMPLETED) {
                    Modifier.clickable(onClick = onClick)
                } else {
                    Modifier
                }
            )
    ) {
        when (item.status) {
            MultiTryOnItemStatus.COMPLETED -> {
                AsyncImage(
                    model = item.resultUrl,
                    contentDescription = item.product.label ?: "Generated look",
                    contentScale = ContentScale.Crop,
                    alignment = Alignment.TopCenter,
                    modifier = Modifier.fillMaxSize()
                )
                actions(item)
            }
            MultiTryOnItemStatus.FAILED -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(sdp(R.dimen._8sdp)),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = "Failed",
                        tint = Color(0xFFE59B17),
                        modifier = Modifier.size(sdp(R.dimen._20sdp))
                    )
                    Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                    Text(
                        text = "Couldn't generate",
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = ssp(R.dimen._11ssp),
                        fontFamily = PoppinsFamily,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                            .border(sdp(R.dimen._1sdp), Color(0xFFE59B17), RoundedCornerShape(sdp(R.dimen._40sdp)))
                            .clickable(onClick = onRetry)
                            .padding(horizontal = sdp(R.dimen._12sdp), vertical = sdp(R.dimen._6sdp)),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Retry",
                            tint = Color(0xFFE59B17),
                            modifier = Modifier.size(sdp(R.dimen._14sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._6sdp)))
                        Text(
                            text = "Retry",
                            color = Color(0xFFE59B17),
                            fontSize = ssp(R.dimen._11ssp),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = PoppinsFamily
                        )
                    }
                }
            }
            MultiTryOnItemStatus.QUEUED, MultiTryOnItemStatus.PROCESSING -> {
                // Slow "breathing" dim instead of a flat static overlay, so the tile itself
                // feels alive while it waits, not just the dots on top of it.
                val breatheTransition = rememberInfiniteTransition(label = "tileBreathe")
                val imageAlpha by breatheTransition.animateFloat(
                    initialValue = 0.22f,
                    targetValue = 0.42f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(durationMillis = 1100, easing = FastOutSlowInEasing),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "tileBreatheAlpha"
                )
                AsyncImage(
                    model = item.product.mannequinResultUrl
                        ?: item.product.thumbnailUrl
                        ?: item.product.imageUrl,
                    contentDescription = item.product.label ?: "Outfit",
                    contentScale = ContentScale.Crop,
                    alignment = Alignment.TopCenter,
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(imageAlpha)
                )
                TryOnLoadingOverlay()
            }
        }
    }
}

// Game-style loading HUD laid over a tile while its look generates: a scanner beam sweeps the
// model, a targeting reticle spins and sparkles rise. It looks the same for the whole wait;
// the API reports no progress, so nothing here pretends to.
@Composable
private fun TryOnLoadingOverlay(modifier: Modifier = Modifier) {
    val gold = Color(0xFFE7A52C)
    val transition = rememberInfiniteTransition(label = "tryOnLoading")
    val scan by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2200, easing = LinearEasing), RepeatMode.Reverse),
        label = "scan"
    )
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(4000, easing = LinearEasing)),
        label = "spin"
    )
    val pulse by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "pulse"
    )

    Box(modifier = modifier.fillMaxSize()) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height

            // scanner beam with a soft glow trailing it
            val y = h * (0.06f + 0.88f * scan)
            val glow = 46.dp.toPx()
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color.Transparent, gold.copy(alpha = 0.38f), Color.Transparent),
                    startY = y - glow,
                    endY = y + glow
                ),
                topLeft = Offset(0f, y - glow),
                size = Size(w, glow * 2f)
            )
            drawLine(Color(0xFFFFE9A8), Offset(0f, y), Offset(w, y), strokeWidth = 2.dp.toPx())

            // corner brackets, like a targeting frame
            val inset = 10.dp.toPx()
            val len = 18.dp.toPx()
            val bracket = gold.copy(alpha = 0.45f + 0.5f * pulse)
            val bw = 3.dp.toPx()
            for (cx in listOf(inset, w - inset)) {
                for (cy in listOf(inset, h - inset)) {
                    val dx = if (cx < w / 2f) len else -len
                    val dy = if (cy < h / 2f) len else -len
                    drawLine(bracket, Offset(cx, cy), Offset(cx + dx, cy), strokeWidth = bw, cap = StrokeCap.Round)
                    drawLine(bracket, Offset(cx, cy), Offset(cx, cy + dy), strokeWidth = bw, cap = StrokeCap.Round)
                }
            }

            // spinning reticle
            val c = Offset(w / 2f, h * 0.45f)
            val r = minOf(w, h) * 0.2f
            rotate(spin, pivot = c) {
                for (k in 0 until 3) {
                    drawArc(
                        color = gold.copy(alpha = 0.9f),
                        startAngle = k * 120f, sweepAngle = 70f, useCenter = false,
                        topLeft = Offset(c.x - r, c.y - r), size = Size(r * 2f, r * 2f),
                        style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round)
                    )
                }
            }
            rotate(-spin * 1.6f, pivot = c) {
                val r2 = r * 0.66f
                for (k in 0 until 2) {
                    drawArc(
                        color = Color.White.copy(alpha = 0.75f),
                        startAngle = k * 180f, sweepAngle = 90f, useCenter = false,
                        topLeft = Offset(c.x - r2, c.y - r2), size = Size(r2 * 2f, r2 * 2f),
                        style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
                    )
                }
            }
            drawCircle(gold.copy(alpha = pulse), radius = 5.dp.toPx() + 3.dp.toPx() * pulse, center = c)

            // sparkles drifting up
            for (i in 0 until 10) {
                val t = ((spin / 360f) * (1 + i % 2) + i * 0.1f) % 1f
                val x = w * (((i * 0.37f) % 0.8f) + 0.1f) + sin(t * 12f + i) * 6.dp.toPx()
                drawCircle(
                    color = (if (i % 2 == 0) gold else Color.White).copy(alpha = sin(Math.PI * t).toFloat() * 0.85f),
                    radius = (1.5f + (i % 3)).dp.toPx(),
                    center = Offset(x, h * (1f - t))
                )
            }
        }
    }
}

@Preview(name = "Multi Try-On Results - Phone", showBackground = true, widthDp = 375, heightDp = 780)
@Composable
private fun MultiTryOnResultsPagePreview() {
    AiVastraTheme {
        MultiTryOnResultsPage(
            items = emptyList(),
            category = "women",
            onRetryItem = {},
            onDownloadAll = {},
            onAddGarments = {},
            onGoHome = {},
            onGoToDownloads = {},
            onRetake = {}
        )
    }
}

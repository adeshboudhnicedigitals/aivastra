package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import aivastra.nice.interactive.ui.screens.KIOSK_DOWNLOAD_BASE_URL
import aivastra.nice.interactive.ui.screens.QrCodeImage
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.ssp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import aivastra.nice.interactive.R
import aivastra.nice.interactive.utils.sdp
import coil.compose.AsyncImage

/**
 * Full-screen swipeable, pinch-zoomable image gallery — the "session history" look shared by
 * every screen that lets the customer flip back through previously generated results. Kept as
 * one component (rather than duplicated per screen) so they stay visually identical and any
 * fix — like the forward/backward arrows — lands everywhere at once.
 */
@Composable
fun ZoomableImageGallery(
    images: List<String>,
    currentIndex: Int,
    onIndexChange: (Int) -> Unit,
    onClose: () -> Unit,
    statusBarH: Dp,
    navBarH: Dp,
    // Parallel to [images] (same index = same result); null/short means "unknown" and that page's
    // QR falls back to the raw image URL.
    jobIds: List<String?> = emptyList()
) {
    // Backs both the arrow buttons and finger-swipe with the same page state so they can
    // never disagree about which result is showing. Swipe is disabled while the current
    // image is pinch-zoomed in, so a horizontal pan-to-inspect never gets mistaken for a
    // page-change swipe — mirrors how Photos/Instagram gate swipe behind zoom state.
    val pagerState = rememberPagerState(initialPage = currentIndex) { images.size }
    var isCurrentPageZoomed by remember { mutableStateOf(false) }

    LaunchedEffect(currentIndex) {
        if (pagerState.currentPage != currentIndex) {
            // Animate only to a neighbour; a long jump (e.g. wrap last -> first) would
            // sweep through every page in between and stutter, so snap instead.
            if (kotlin.math.abs(pagerState.currentPage - currentIndex) > 1) {
                pagerState.scrollToPage(currentIndex)
            } else {
                pagerState.animateScrollToPage(currentIndex)
            }
        }
    }
    // settledPage (not currentPage): reporting mid-animation pages back to the parent changed
    // currentIndex while the button-driven scroll was running and kept cancelling it.
    LaunchedEffect(pagerState.settledPage) {
        isCurrentPageZoomed = false
        if (pagerState.settledPage != currentIndex) {
            onIndexChange(pagerState.settledPage)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        HorizontalPager(
            state = pagerState,
            userScrollEnabled = !isCurrentPageZoomed,
            beyondViewportPageCount = 1,
            modifier = Modifier.fillMaxSize()
        ) { page ->
            ZoomableGalleryImage(
                url = images[page],
                contentDescription = "Result ${page + 1} of ${images.size}",
                page = page,
                onZoomedChange = { zoomed ->
                    if (page == pagerState.currentPage) isCurrentPageZoomed = zoomed
                }
            )
        }

        // Close button
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = statusBarH, end = sdp(R.dimen._18sdp))
                .size(sdp(R.dimen._52sdp))
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.6f))
                .clickable(onClick = onClose),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.Close,
                contentDescription = "Close",
                tint = Color.White,
                modifier = Modifier.size(sdp(R.dimen._28sdp))
            )
        }

        // Per-result QR so the customer can scan the photo they're looking at and save it.
        // The QR points at the branded kiosk-download page for this one job (not the multi-result
        // "Download All" page, and not the raw presigned storage URL: that one is long, off-brand
        // and dead after its 24h expiry, whereas the page re-presigns on every visit). Falls back
        // to the raw URL when the job IDs don't line up with the images.
        val qrContentForPage = images.getOrNull(currentIndex)?.takeIf { it.isNotBlank() }?.let { imageUrl ->
            val jobId = if (jobIds.size == images.size) jobIds.getOrNull(currentIndex) else null
            if (!jobId.isNullOrBlank()) "$KIOSK_DOWNLOAD_BASE_URL?jobs=$jobId" else imageUrl
        }
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = sdp(R.dimen._16sdp), bottom = navBarH + sdp(R.dimen._16sdp)),
            horizontalAlignment = Alignment.End
        ) {
        qrContentForPage?.let { qrContent ->
            // Solid white card: a QR needs a full light quiet zone and max contrast to scan fast.
            Column(
                modifier = Modifier
                    .clip(RoundedCornerShape(sdp(R.dimen._16sdp)))
                    .background(Color.White)
                    .padding(sdp(R.dimen._10sdp)),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                QrCodeImage(content = qrContent, modifier = Modifier.size(sdp(R.dimen._150sdp)))
                Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                Text(
                    text = "Scan to download",
                    color = Color.Black,
                    fontSize = ssp(R.dimen._13ssp),
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = PoppinsFamily
                )
            }
        }
        }

        if (images.size > 1) {
            val historySize = images.size
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(sdp(R.dimen._16sdp))
                    .size(sdp(R.dimen._52sdp))
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                        )
                    )
                    .clickable {
                        onIndexChange(if (currentIndex - 1 < 0) historySize - 1 else currentIndex - 1)
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = "Previous result",
                    tint = Color.White,
                    modifier = Modifier.size(sdp(R.dimen._32sdp))
                )
            }

            Box(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(sdp(R.dimen._16sdp))
                    .size(sdp(R.dimen._52sdp))
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                        )
                    )
                    .clickable {
                        onIndexChange((currentIndex + 1) % historySize)
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = "Next result",
                    tint = Color.White,
                    modifier = Modifier.size(sdp(R.dimen._32sdp))
                )
            }

            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = navBarH + sdp(R.dimen._20sdp)),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._6sdp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                images.indices.forEach { index ->
                    val isActive = index == currentIndex
                    Box(
                        modifier = Modifier
                            .size(if (isActive) sdp(R.dimen._8sdp) else sdp(R.dimen._6sdp))
                            .clip(CircleShape)
                            .background(
                                if (isActive) Color(0xFFE7A52C) else Color.White.copy(alpha = 0.4f)
                            )
                            .clickable { onIndexChange(index) }
                    )
                }
            }
        }
    }
}

// Reimplements just enough of [detectTransformGestures] to gate event consumption on
// [isZoomed] — a plain single-finger drag is left completely unconsumed (and thus never
// even marked as "past touch slop") so the enclosing HorizontalPager sees an untouched
// gesture and can claim it for page-swiping. Only an actual pinch (2+ pointers) or a pan
// while already zoomed in is consumed here. detectTransformGestures itself has no such
// escape hatch — it swallows every single-finger drag unconditionally — which is why
// swipe silently did nothing before this.
private suspend fun PointerInputScope.detectZoomPanGestures(
    isZoomed: () -> Boolean,
    onGesture: (pan: Offset, zoom: Float) -> Unit
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        do {
            val event = awaitPointerEvent()
            val canceled = event.changes.any { it.isConsumed }
            if (!canceled) {
                val multitouch = event.changes.size > 1
                if (multitouch || isZoomed()) {
                    val zoomChange = event.calculateZoom()
                    val panChange = event.calculatePan()
                    if (zoomChange != 1f || panChange != Offset.Zero) {
                        onGesture(panChange, zoomChange)
                    }
                    event.changes.forEach { change ->
                        if (change.positionChanged()) change.consume()
                    }
                }
            }
        } while (!canceled && event.changes.any { it.pressed })
    }
}

// Pinch-to-zoom / pan / double-tap-to-reset. Pan is clamped to the overflow the current zoom
// level actually produces so the image can never be dragged off past its own edge. Zoom state
// resets per page automatically ([remember] keyed on [page]), and only consumes horizontal
// drags itself once zoomed past 1x — at 1x, drags fall through untouched to the enclosing
// HorizontalPager so swipe-to-change-image works.
@Composable
private fun ZoomableGalleryImage(
    url: String,
    contentDescription: String,
    page: Int = 0,
    onZoomedChange: (Boolean) -> Unit = {}
) {
    var imageScale by remember(page) { mutableFloatStateOf(1f) }
    var imageOffset by remember(page) { mutableStateOf(Offset.Zero) }
    var imageContainerSize by remember(page) { mutableStateOf(IntSize.Zero) }

    AsyncImage(
        model = url,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        alignment = Alignment.TopCenter,
        modifier = Modifier
            .fillMaxSize()
            .clipToBounds()
            .onGloballyPositioned { imageContainerSize = it.size }
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = {
                    imageScale = 1f
                    imageOffset = Offset.Zero
                    onZoomedChange(false)
                })
            }
            .pointerInput(Unit) {
                detectZoomPanGestures(isZoomed = { imageScale > 1.01f }) { pan, zoom ->
                    val newScale = (imageScale * zoom).coerceIn(1f, 4f)
                    val maxPanX = (imageContainerSize.width * (newScale - 1f) / 2f).coerceAtLeast(0f)
                    val maxPanY = (imageContainerSize.height * (newScale - 1f) / 2f).coerceAtLeast(0f)
                    imageOffset = Offset(
                        x = (imageOffset.x + pan.x).coerceIn(-maxPanX, maxPanX),
                        y = (imageOffset.y + pan.y).coerceIn(-maxPanY, maxPanY)
                    )
                    imageScale = newScale
                    onZoomedChange(newScale > 1.01f)
                }
            }
            .graphicsLayer {
                scaleX = imageScale
                scaleY = imageScale
                translationX = imageOffset.x
                translationY = imageOffset.y
            }
    )
}

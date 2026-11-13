package aivastra.nice.interactive.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.components.CreditAlertGate
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import androidx.compose.runtime.rememberCoroutineScope

@Composable
fun TryOnResultPage(
    resultImageUrl: String,
    onBack: () -> Unit,
    onTryAnother: () -> Unit,
    tryAnotherLabel: String = "Try Another",
    // Quick try-on: every result from this session, shown with previous/next buttons like the
    // regular session gallery. Empty keeps the single-image behaviour.
    sessionResults: List<String> = emptyList(),
    onDownload: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val coroutineScope = rememberCoroutineScope()

    BackHandler(onBack = onBack)

    // Low-credit / out-of-credit heads-up, re-checked for each new result. Skipped in
    // previews, which have no session or network.
    if (!isPreview) CreditAlertGate(refreshKey = resultImageUrl to sessionResults.size)

    // Pinch-to-zoom / pan / double-tap-to-reset on the result image. Pan is clamped to the
    // overflow the current zoom level actually produces (half the extra scaled size in each
    // direction), so the image can never be dragged off past its own edge, and it collapses
    // back to (0,0) on its own as the user zooms back out to 1x.
    var imageScale by remember { mutableFloatStateOf(1f) }
    var imageOffset by remember { mutableStateOf(Offset.Zero) }
    var imageContainerSize by remember { mutableStateOf(IntSize.Zero) }

    // Lands on the newest result whenever one is added, then lets the customer page through.
    var historyIndex by remember { mutableIntStateOf(sessionResults.lastIndex.coerceAtLeast(0)) }
    LaunchedEffect(sessionResults.size) {
        historyIndex = sessionResults.lastIndex.coerceAtLeast(0)
    }
    val showHistory = sessionResults.size > 1
    val shownUrl = if (showHistory) sessionResults[historyIndex.coerceIn(0, sessionResults.lastIndex)] else resultImageUrl
    LaunchedEffect(shownUrl) {
        imageScale = 1f
        imageOffset = Offset.Zero
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Result Image Display
        AsyncImage(
            model = shownUrl,
            contentDescription = "Try-On Result",
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .clipToBounds()
                .onGloballyPositioned { imageContainerSize = it.size }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = {
                        imageScale = 1f
                        imageOffset = Offset.Zero
                    })
                }
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        val newScale = (imageScale * zoom).coerceIn(1f, 4f)
                        val maxPanX = (imageContainerSize.width * (newScale - 1f) / 2f).coerceAtLeast(0f)
                        val maxPanY = (imageContainerSize.height * (newScale - 1f) / 2f).coerceAtLeast(0f)
                        imageOffset = Offset(
                            x = (imageOffset.x + pan.x).coerceIn(-maxPanX, maxPanX),
                            y = (imageOffset.y + pan.y).coerceIn(-maxPanY, maxPanY)
                        )
                        imageScale = newScale
                    }
                }
                .graphicsLayer {
                    scaleX = imageScale
                    scaleY = imageScale
                    translationX = imageOffset.x
                    translationY = imageOffset.y
                }
        )

        if (showHistory) {
            val count = sessionResults.size
            val arrowBrush = Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100)))
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(sdp(R.dimen._16sdp))
                    .size(sdp(R.dimen._36sdp))
                    .clip(CircleShape)
                    .background(arrowBrush)
                    .clickable { historyIndex = if (historyIndex - 1 < 0) count - 1 else historyIndex - 1 },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = "Previous result",
                    tint = Color.White,
                    modifier = Modifier.size(sdp(R.dimen._22sdp))
                )
            }
            Box(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(sdp(R.dimen._16sdp))
                    .size(sdp(R.dimen._36sdp))
                    .clip(CircleShape)
                    .background(arrowBrush)
                    .clickable { historyIndex = (historyIndex + 1) % count },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = "Next result",
                    tint = Color.White,
                    modifier = Modifier.size(sdp(R.dimen._22sdp))
                )
            }
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = navBarH + sdp(R.dimen._34sdp) + sdp(R.dimen._bottom_action_button_height) + sdp(R.dimen._28sdp)),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._6sdp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                sessionResults.indices.forEach { index ->
                    val isActive = index == historyIndex
                    Box(
                        modifier = Modifier
                            .size(if (isActive) sdp(R.dimen._8sdp) else sdp(R.dimen._6sdp))
                            .clip(CircleShape)
                            .background(if (isActive) Color(0xFFE7A52C) else Color.White.copy(alpha = 0.4f))
                            .clickable { historyIndex = index }
                    )
                }
            }
        }

        // Floating Content Overlay with status bar inset handling
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = sdp(R.dimen._18sdp),
                    end = sdp(R.dimen._18sdp),
                    top = statusBarH + sdp(R.dimen._10sdp),
                    bottom = sdp(R.dimen._34sdp) + navBarH
                ),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Top Bar (Golden Back Arrow + Ai Vastra Logo)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = sdp(R.dimen._screen_container_width)),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Golden Amber Gradient Back Arrow
                Box(
                    modifier = Modifier
                        .size(sdp(R.dimen._38sdp))
                        .clip(CircleShape)
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                            )
                        )
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onBack
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White,
                        modifier = Modifier.size(sdp(R.dimen._20sdp))
                    )
                }

                AppHeaderLogo()
            }

            // Bottom Floating Action Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = sdp(R.dimen._screen_container_width))
                    .padding(bottom = sdp(R.dimen._12sdp)),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left Button: "Try Another" (Solid White Container)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._bottom_action_button_height))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(Color.White)
                        .clickable(onClick = onTryAnother),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = tryAnotherLabel,
                            tint = Color(0xFF7E3D00),
                            modifier = Modifier.size(sdp(R.dimen._22sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        Text(
                            text = tryAnotherLabel,
                            color = Color(0xFF7E3D00),
                            fontSize = ssp(R.dimen._16ssp),
                            fontWeight = FontWeight.Bold,
                            fontFamily = PoppinsFamily
                        )
                    }
                }

                // Right Button: "Download" (App Gold/Amber Gradient Container)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._bottom_action_button_height))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                            )
                        )
                        .clickable(onClick = onDownload),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        DownloadIcon(
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._22sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        Text(
                            text = "Download",
                            color = Color.White,
                            fontSize = ssp(R.dimen._16ssp),
                            fontWeight = FontWeight.Bold,
                            fontFamily = PoppinsFamily
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DownloadIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val strokeWidth = 2.5.dp.toPx()

        // Downward arrow stem and head
        drawLine(color = tint, start = Offset(w / 2, h * 0.15f), end = Offset(w / 2, h * 0.62f), strokeWidth = strokeWidth)
        drawLine(color = tint, start = Offset(w * 0.25f, h * 0.42f), end = Offset(w / 2, h * 0.62f), strokeWidth = strokeWidth)
        drawLine(color = tint, start = Offset(w * 0.75f, h * 0.42f), end = Offset(w / 2, h * 0.62f), strokeWidth = strokeWidth)

        // Bottom horizontal tray line
        drawLine(color = tint, start = Offset(w * 0.2f, h * 0.82f), end = Offset(w * 0.8f, h * 0.82f), strokeWidth = strokeWidth)
    }
}

@Preview(name = "Try-On Result - Phone", showBackground = true, widthDp = 375, heightDp = 667)
@Composable
private fun TryOnResultPagePreview() {
    AiVastraTheme {
        TryOnResultPage(
            resultImageUrl = "",
            onBack = {},
            onTryAnother = {}
        )
    }
}

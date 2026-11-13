package aivastra.nice.interactive.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.Path
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import kotlin.math.cos
import kotlin.math.sin
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.runtime.getValue
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlin.math.abs

private val Gold = Color(0xFFE7A52C)

private fun CatalogProduct.imageForCard(): String? =
    mannequinResultUrl ?: imageUrl ?: thumbnailUrl

/**
 * Multi-select browser: a coverflow-style pager where the centred garment is large and its
 * neighbours shrink and fade. Swipe sideways to browse, swipe the centred card up (or tap it)
 * to add it to the selection, swipe it down to remove it. Everything picked is mirrored in a
 * tray along the bottom.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GarmentCarousel(
    products: List<CatalogProduct>,
    selected: List<CatalogProduct>,
    onToggle: (CatalogProduct) -> Unit,
    onRemove: (CatalogProduct) -> Unit,
    fitSubcategoryIds: Set<String> = emptySet(),
    canAddMore: Boolean = true,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val pagerState = rememberPagerState(pageCount = { products.size })
    val current = products.getOrNull(pagerState.currentPage)
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp
    val cardWidth = screenWidth * 0.46f
    val dens = LocalDensity.current
    val cardWidthPx = with(dens) { cardWidth.toPx() }

    // Selecting launches a "flight": sparkles burst from the card and a ghost copy
    // flies down into the tray, where the real thumbnail stays hidden until it lands.
    var flight by remember { mutableStateOf<CatalogProduct?>(null) }
    val progress = remember { Animatable(0f) }
    var rootOrigin by remember { mutableStateOf(Offset.Zero) }
    var pagerBounds by remember { mutableStateOf(Rect.Zero) }
    var trayBounds by remember { mutableStateOf(Rect.Zero) }

    val ambientTransition = rememberInfiniteTransition(label = "ambient")
    val ambient by ambientTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(14000, easing = LinearEasing)),
        label = "ambientT"
    )
    val glow by ambientTransition.animateFloat(
        initialValue = 0.25f,
        targetValue = 0.55f,
        animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse),
        label = "glow"
    )

    val trayPulse = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(flight) {
        if (flight != null) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            progress.snapTo(0f)
            progress.animateTo(1f, tween(950, easing = LinearEasing))
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            scope.launch {
                trayPulse.snapTo(1f)
                trayPulse.animateTo(0f, tween(700))
            }
            flight = null
        }
    }

    fun toggle(product: CatalogProduct) {
        val isAdding = selected.none { it.id == product.id } && canAddMore
        if (isAdding) flight = product
        onToggle(product)
        // Move on to the next garment once the picked card has started flying to the tray.
        if (isAdding && pagerState.currentPage < products.lastIndex) {
            val next = pagerState.currentPage + 1
            scope.launch {
                kotlinx.coroutines.delay(300)
                pagerState.animateScrollToPage(next)
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .onGloballyPositioned { rootOrigin = it.positionInRoot() }
    ) {
    Canvas(modifier = Modifier.fillMaxSize()) {
        if (pagerBounds != Rect.Zero) {
            val c = pagerBounds.center - rootOrigin
            val radius = cardWidthPx * 1.15f
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Gold.copy(alpha = glow * 0.6f),
                        Color(0xFF8B5CF6).copy(alpha = glow * 0.35f),
                        Color.Transparent
                    ),
                    center = c,
                    radius = radius
                ),
                radius = radius,
                center = c
            )
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        HorizontalPager(
            state = pagerState,
            pageSize = PageSize.Fixed(cardWidth),
            contentPadding = PaddingValues(horizontal = (screenWidth - cardWidth) / 2),
            pageSpacing = 0.dp,
            key = { products[it].id },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .onGloballyPositioned { pagerBounds = it.boundsInRoot() }
        ) { page ->
            val product = products[page]
            val isSelected = selected.any { it.id == product.id }
            val offset = (pagerState.currentPage - page) + pagerState.currentPageOffsetFraction
            val distance = abs(offset).coerceIn(0f, 1f)

            CarouselCard(
                product = product,
                fitImage = product.subcategoryId in fitSubcategoryIds,
                isSelected = isSelected,
                isCentered = page == pagerState.currentPage,
                onToggle = { toggle(product) },
                onSwipeUp = { if (isSelected) toggle(product) },
                onSwipeDown = { if (!isSelected) toggle(product) },
                modifier = Modifier
                    .padding(vertical = sdp(R.dimen._40sdp))
                    .zIndex(1f - distance)
                    .graphicsLayer {
                        // Pull neighbours in so the centred card overlaps the before/after ones.
                        translationX = offset.coerceIn(-2f, 2f) * cardWidthPx * 0.4f
                        // Side cards turn inward like a coverflow.
                        cameraDistance = 12f * density
                        rotationY = offset.coerceIn(-1f, 1f) * 28f
                        val scale = 1f - 0.2f * distance
                        scaleX = scale
                        scaleY = scale
                        alpha = if (abs(offset) > 1.5f) 0f else 1f - 0.4f * distance
                    }
            )
        }

        if (current != null) {
            val hint = if (selected.any { it.id == current.id }) "Selected  •  swipe up to remove"
            else "Swipe down or tap to select"
            Crossfade(targetState = hint, label = "hint") { text ->
            Text(
                text = text,
                color = Color.White.copy(alpha = 0.65f),
                fontSize = ssp(R.dimen._10ssp),
                fontFamily = PoppinsFamily,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = sdp(R.dimen._4sdp), bottom = sdp(R.dimen._6sdp))
            )
            }
        }

        SelectedTray(
            selected = selected,
            onRemove = onRemove,
            hiddenId = flight?.id,
            pulse = trayPulse.value,
            actionLabel = actionLabel,
            onAction = onAction,
            modifier = Modifier.onGloballyPositioned { trayBounds = it.boundsInRoot() }
        )
    }

    flight?.let { product ->
        val p = progress.value
        val start = pagerBounds.center - rootOrigin
        val itemPx = with(dens) { 44.dp.toPx() + 8.dp.toPx() }
        val padPx = with(dens) { sdp(R.dimen._22sdp).toPx() }
        val slots = (((trayBounds.width - 2 * padPx) / itemPx).toInt()).coerceAtLeast(1)
        val slot = (selected.size - 1).coerceIn(0, slots - 1)
        val end = Offset(
            trayBounds.left + padPx + itemPx * slot + itemPx / 2f,
            trayBounds.bottom - with(dens) { 40.dp.toPx() }
        ) - rootOrigin
        val ghostW = cardWidth
        val ghostH = cardWidth * 1.3f
        val fly = ((p - 0.22f) / 0.78f).coerceIn(0f, 1f)
        val eased = FastOutSlowInEasing.transform(fly)
        val x = start.x + (end.x - start.x) * eased
        val y = start.y + (end.y - start.y) * eased - sin(Math.PI * eased).toFloat() * with(dens) { 50.dp.toPx() }
        val ghostScale = 1f - 0.82f * eased
        val arc = with(dens) { 70.dp.toPx() }
        fun pathAt(e: Float) = Offset(
            start.x + (end.x - start.x) * e,
            start.y + (end.y - start.y) * e - sin(Math.PI * e).toFloat() * arc
        )

        // Glowing comet trail behind the ghost.
        Canvas(modifier = Modifier.fillMaxSize()) {
            for (k in 1..10) {
                val e = FastOutSlowInEasing.transform((fly - k * 0.045f).coerceIn(0f, 1f))
                if (fly <= 0f || e <= 0f) continue
                val pos = pathAt(e)
                drawCircle(
                    color = (if (k % 2 == 0) Gold else Color.White).copy(alpha = 0.55f * (1f - k / 11f)),
                    radius = (16 - k).coerceAtLeast(2).dp.toPx(),
                    center = pos
                )
            }
        }

        AsyncImage(
            model = product.imageForCard(),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(ghostW, ghostH)
                .graphicsLayer {
                    translationX = x - ghostW.toPx() / 2f
                    translationY = y - ghostH.toPx() / 2f
                    scaleX = ghostScale
                    scaleY = ghostScale
                    // A little spin as it leaves, settling flat as it lands.
                    rotationZ = sin(Math.PI * eased).toFloat() * -18f
                    cameraDistance = 14f * density
                    rotationY = eased * 360f
                    alpha = if (p < 0.97f) 1f else (1f - p) / 0.03f
                }
                .clip(RoundedCornerShape(sdp(R.dimen._20sdp)))
                .border(sdp(R.dimen._2sdp), Gold, RoundedCornerShape(sdp(R.dimen._20sdp)))
        )

        // Burst at the card: expanding rings plus a spray of sparkles and tiny stars.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val q = (p / 0.5f).coerceIn(0f, 1f)
            if (q < 1f) {
                val ease = FastOutSlowInEasing.transform(q)
                drawCircle(
                    color = Gold.copy(alpha = 0.9f * (1f - q)),
                    radius = 30.dp.toPx() + 150.dp.toPx() * ease,
                    center = start,
                    style = Stroke(width = (6 * (1f - q) + 1).dp.toPx())
                )
                drawCircle(
                    color = Color.White.copy(alpha = 0.6f * (1f - q)),
                    radius = 20.dp.toPx() + 100.dp.toPx() * ease,
                    center = start,
                    style = Stroke(width = (3 * (1f - q) + 1).dp.toPx())
                )
                val count = 28
                for (i in 0 until count) {
                    val angle = (2 * Math.PI * i / count).toFloat() + (i % 4) * 0.12f
                    val reach = (60.dp.toPx() + (i % 5) * 26.dp.toPx()) * ease
                    // Sparkles fall slightly under gravity.
                    val drop = 40.dp.toPx() * q * q
                    val c = Offset(start.x + cos(angle) * reach, start.y + sin(angle) * reach + drop)
                    val color = when (i % 3) {
                        0 -> Gold
                        1 -> Color.White
                        else -> Color(0xFFFFD98A)
                    }.copy(alpha = 1f - q)
                    val r = (6 - 4 * q).dp.toPx() * (if (i % 3 == 0) 1.4f else 1f)
                    if (i % 4 == 0) {
                        drawLine(color, Offset(c.x - r * 1.6f, c.y), Offset(c.x + r * 1.6f, c.y), strokeWidth = 2.dp.toPx())
                        drawLine(color, Offset(c.x, c.y - r * 1.6f), Offset(c.x, c.y + r * 1.6f), strokeWidth = 2.dp.toPx())
                    } else {
                        drawCircle(color, radius = r, center = c)
                    }
                }
            }

            // Confetti shoots up, then flutters down.
            val cq = (p / 0.8f).coerceIn(0f, 1f)
            if (cq < 1f) {
                val palette = listOf(Gold, Color.White, Color(0xFFFF6FA5), Color(0xFF6FD6FF), Color(0xFFB69CFF))
                for (i in 0 until 22) {
                    val spread = ((i * 37) % 100) / 100f - 0.5f
                    val power = 0.6f + ((i * 53) % 100) / 100f * 0.8f
                    val tt = cq * 1.4f
                    val cx = start.x + spread * 260.dp.toPx() * cq * power
                    val cy = start.y + (-420.dp.toPx() * power * tt + 520.dp.toPx() * tt * tt)
                    val spin = (cq * 720f + i * 40f)
                    rotate(spin, pivot = Offset(cx, cy)) {
                        drawRect(
                            color = palette[i % palette.size].copy(alpha = 1f - cq * cq),
                            topLeft = Offset(cx - 4.dp.toPx(), cy - 2.dp.toPx()),
                            size = androidx.compose.ui.geometry.Size(8.dp.toPx(), 4.dp.toPx())
                        )
                    }
                }
            }

            // Ring where the garment lands in the tray.
            val lq = ((p - 0.82f) / 0.18f).coerceIn(0f, 1f)
            if (lq > 0f) {
                drawCircle(
                    color = Gold.copy(alpha = 1f - lq),
                    radius = 14.dp.toPx() + 40.dp.toPx() * lq,
                    center = end,
                    style = Stroke(width = 3.dp.toPx())
                )
            }
        }

        // "+1" floats up from the card.
        Text(
            text = "+1",
            color = Gold,
            fontSize = ssp(R.dimen._24ssp),
            fontWeight = FontWeight.Bold,
            fontFamily = PoppinsFamily,
            modifier = Modifier.graphicsLayer {
                translationX = start.x - 18.dp.toPx()
                translationY = start.y - 90.dp.toPx() - 90.dp.toPx() * FastOutSlowInEasing.transform((p / 0.7f).coerceIn(0f, 1f))
                val a = if (p < 0.1f) p / 0.1f else (1f - (p - 0.1f) / 0.6f).coerceIn(0f, 1f)
                alpha = a
                val sc = 0.6f + 0.6f * sin(Math.PI * (p / 0.35f).coerceIn(0f, 1f)).toFloat() + 0.4f * (p / 0.35f).coerceIn(0f, 1f)
                scaleX = sc
                scaleY = sc
            }
        )
    }
    }
}

@Composable
private fun CarouselCard(
    product: CatalogProduct,
    fitImage: Boolean,
    isSelected: Boolean,
    isCentered: Boolean,
    onToggle: () -> Unit,
    onSwipeUp: () -> Unit,
    onSwipeDown: () -> Unit,
    modifier: Modifier = Modifier
) {
    val shape = RoundedCornerShape(sdp(R.dimen._20sdp))
    val scope = rememberCoroutineScope()
    val lift = remember { Animatable(0f) }
    val pop by animateFloatAsState(
        targetValue = if (isSelected) 1.06f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "pop"
    )
    val shine by rememberInfiniteTransition(label = "shine").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(3200, easing = LinearEasing)),
        label = "shineT"
    )
    val flash = remember { Animatable(0f) }
    LaunchedEffect(isSelected) {
        if (isSelected) {
            flash.snapTo(0.75f)
            flash.animateTo(0f, tween(500))
        }
    }
    val borderColor by animateColorAsState(
        targetValue = if (isSelected) Gold else Color.White.copy(alpha = if (isCentered) 0.35f else 0.12f),
        label = "border"
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .graphicsLayer {
                translationY = lift.value
                scaleX = pop
                scaleY = pop
            }
            .clip(shape)
            .background(
                Brush.verticalGradient(listOf(Color(0xFF2A2140), Color(0xFF14101F)))
            )
            .border(
                sdp(R.dimen._2sdp),
                borderColor,
                shape
            )
            .clickable(enabled = isCentered, onClick = onToggle)
            .pointerInput(isCentered, isSelected) {
                if (!isCentered) return@pointerInput
                var total = 0f
                detectVerticalDragGestures(
                    onDragStart = { total = 0f },
                    onVerticalDrag = { change, delta ->
                        change.consume()
                        total += delta
                        scope.launch { lift.snapTo((total * 0.4f).coerceIn(-120f, 120f)) }
                    },
                    onDragEnd = {
                        val threshold = 80.dp.toPx()
                        if (total < -threshold) onSwipeUp() else if (total > threshold) onSwipeDown()
                        scope.launch { lift.animateTo(0f) }
                    },
                    onDragCancel = { scope.launch { lift.animateTo(0f) } }
                )
            }
    ) {
        if (fitImage) {
            // Blurred, dimmed copy of the photo fills the card behind the full (uncropped) image.
            AsyncImage(
                model = product.imageForCard(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .blur(24.dp)
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.25f))
            )
        }
        AsyncImage(
            model = product.imageForCard(),
            contentDescription = product.label ?: "Outfit",
            contentScale = if (fitImage) ContentScale.Fit else ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.White.copy(alpha = flash.value))
        )

        if (isCentered && !isSelected) {
            Canvas(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = sdp(R.dimen._10sdp))
                    .size(sdp(R.dimen._30sdp), sdp(R.dimen._26sdp))
            ) {
                val bob = sin(shine * 6.2832f * 4f) * 3.dp.toPx()
                drawCircle(Color.Black.copy(alpha = 0.3f), radius = size.width / 2f, center = center)
                for (k in 0 until 2) {
                    val y = size.height * (0.3f + k * 0.25f) + bob
                    val a = 0.5f + 0.5f * sin(shine * 6.2832f * 4f - k * 1.2f)
                    drawPath(
                        Path().apply {
                            moveTo(size.width * 0.3f, y)
                            lineTo(size.width * 0.5f, y + size.height * 0.15f)
                            lineTo(size.width * 0.7f, y)
                        },
                        Color.White.copy(alpha = 0.35f + 0.6f * a),
                        style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
                    )
                }
            }
        }

        AnimatedVisibility(
            visible = isSelected,
            enter = scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
            modifier = Modifier.align(Alignment.TopEnd)
        ) {
            Box(
                modifier = Modifier
                    .padding(sdp(R.dimen._10sdp))
                    .size(sdp(R.dimen._26sdp))
                    .clip(CircleShape)
                    .background(Gold),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Selected",
                    tint = Color.Black,
                    modifier = Modifier.size(sdp(R.dimen._16sdp))
                )
            }
        }
    }
}

@Composable
private fun SelectedTray(
    selected: List<CatalogProduct>,
    onRemove: (CatalogProduct) -> Unit,
    hiddenId: String?,
    pulse: Float,
    actionLabel: String?,
    onAction: () -> Unit,
    modifier: Modifier = Modifier
) {
    val flow by rememberInfiniteTransition(label = "trayBg").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(6000, easing = LinearEasing)),
        label = "trayFlow"
    )
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(selected.size) {
        if (selected.isNotEmpty()) listState.animateScrollToItem(selected.lastIndex)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = sdp(R.dimen._18sdp), topEnd = sdp(R.dimen._18sdp)))
            .background(Color.White.copy(alpha = 0.08f))
            .background(Gold.copy(alpha = 0.28f * pulse))
            .drawBehind {
                val w = size.width
                val h = size.height
                // colour wash drifting sideways
                drawRect(
                    Brush.horizontalGradient(
                        colors = listOf(
                            Color(0xFF8B5CF6).copy(alpha = 0.22f),
                            Gold.copy(alpha = 0.2f),
                            Color(0xFF8B5CF6).copy(alpha = 0.22f)
                        ),
                        startX = flow * w,
                        endX = flow * w + w,
                        tileMode = TileMode.Mirror
                    )
                )
            }
            .padding(vertical = sdp(R.dimen._8sdp))
    ) {
        // Keep the tray's height while empty so the fly-in target stays valid.
        if (selected.isEmpty()) Spacer(Modifier.height(sdp(R.dimen._55sdp)))
        Row(verticalAlignment = Alignment.CenterVertically) {
        LazyRow(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = sdp(R.dimen._22sdp)),
            horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._8sdp))
        ) {
            items(selected, key = { it.id }) { product ->
                val isHidden = product.id == hiddenId
                val pop = remember { Animatable(1f) }
                var wasHidden by remember { mutableStateOf(isHidden) }
                LaunchedEffect(isHidden) {
                    if (wasHidden && !isHidden) {
                        pop.snapTo(1.7f)
                        pop.animateTo(1f, spring(Spring.DampingRatioHighBouncy, Spring.StiffnessMedium))
                    }
                    wasHidden = isHidden
                }
                Box(
                    modifier = Modifier
                        .animateItem()
                        .graphicsLayer {
                            scaleX = pop.value
                            scaleY = pop.value
                        }
                        .alpha(if (isHidden) 0f else 1f)
                        .height(sdp(R.dimen._55sdp))
                        .aspectRatio(0.8f)
                ) {
                    AsyncImage(
                        model = product.imageForCard(),
                        contentDescription = product.label ?: "Selected outfit",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
                            .background(Color(0xFF2A2140))
                            .border(
                                sdp(R.dimen._1sdp),
                                Gold,
                                RoundedCornerShape(sdp(R.dimen._8sdp))
                            )
                    )
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(sdp(R.dimen._16sdp))
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.7f))
                            .clickable { onRemove(product) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Remove",
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._10sdp))
                        )
                    }
                }
            }
        }
        if (actionLabel != null && selected.isNotEmpty()) {
            val beat by rememberInfiniteTransition(label = "actionBeat").animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(1100), RepeatMode.Reverse),
                label = "actionBeatT"
            )
            val sweep by rememberInfiniteTransition(label = "actionShine").animateFloat(
                initialValue = -1f,
                targetValue = 2f,
                animationSpec = infiniteRepeatable(tween(2200, easing = LinearEasing)),
                label = "actionShineT"
            )
            val buttonShape = RoundedCornerShape(sdp(R.dimen._40sdp))
            Text(
                text = actionLabel,
                color = Color.Black,
                fontSize = ssp(R.dimen._15ssp),
                fontWeight = FontWeight.Bold,
                fontFamily = PoppinsFamily,
                maxLines = 1,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(end = sdp(R.dimen._16sdp), start = sdp(R.dimen._4sdp))
                    .graphicsLayer {
                        val s = 1f + 0.06f * beat
                        scaleX = s
                        scaleY = s
                    }
                    .width(150.dp)
                    .clip(buttonShape)
                    .background(Brush.linearGradient(listOf(Color(0xFFF3BE4F), Color(0xFFB86A00))))
                    .drawBehind {
                        val x = sweep * size.width
                        drawRect(
                            Brush.linearGradient(
                                colors = listOf(Color.Transparent, Color.White.copy(alpha = 0.55f), Color.Transparent),
                                start = Offset(x - size.width * 0.3f, 0f),
                                end = Offset(x + size.width * 0.3f, size.height)
                            )
                        )
                    }
                    .clickable(onClick = onAction)
                    .padding(horizontal = sdp(R.dimen._16sdp), vertical = sdp(R.dimen._18sdp))
            )
        }
        }
    }
}

/**
 * Slot after the picked tiles. While nothing is picked a cartoon cat strolls back and forth,
 * blinking and "thinking" (...). Once something is picked she is [happy]: she hops on the spot
 * with closed smiling eyes, a fast-wagging tail and hearts floating up, asking for more.
 */
@Composable
private fun WaitingSlot(happy: Boolean, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "waiting")
    val twoPi = (2 * Math.PI).toFloat()
    val step by transition.animateFloat(
        initialValue = 0f,
        targetValue = twoPi,
        animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing)),
        label = "step"
    )
    val stroll by transition.animateFloat(
        initialValue = 0f,
        targetValue = twoPi,
        animationSpec = infiniteRepeatable(tween(5200, easing = LinearEasing)),
        label = "stroll"
    )
    val pulse by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(tween(1100), RepeatMode.Reverse),
        label = "pulse"
    )

    Box(
        modifier = modifier
            .height(sdp(R.dimen._55sdp))
            .aspectRatio(1.9f)
            .drawBehind {
                drawRoundRect(
                    color = Gold.copy(alpha = pulse),
                    cornerRadius = CornerRadius(8.dp.toPx()),
                    style = Stroke(
                        width = 1.5.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f), step * 4f)
                    )
                )
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val u = size.height / 11f
            // Strolls left and right, turning round at each end.
            val dir = if (happy || cos(stroll) >= 0f) 1f else -1f
            val cx = if (happy) size.width / 2f - u * 1.2f else size.width / 2f + sin(stroll) * (size.width / 2f - u * 4.8f)
            val swing = if (happy) 0f else sin(step)
            val bob = if (happy) abs(sin(step * 0.5f)) * u * 1.8f else abs(swing) * u * 0.25f
            val tuck = if (happy) bob * 0.9f else 0f

            val fur = Color(0xFFFFA94D)
            val furDark = Color(0xFFE0822A)
            val belly = Color(0xFFFFE2BC)
            val pink = Color(0xFFFF8FB3)
            val ink = Color(0xFF2E2030)

            val footY = size.height - u * 0.6f
            val bodyY = footY - u * 3.3f - bob
            val headC = Offset(cx + dir * u * 2.7f, bodyY - u * 1.3f)
            val headR = u * 2.0f

            // tail waves behind, tip curling up
            val tailBase = Offset(cx - dir * u * 2.0f, bodyY - u * 0.4f)
            val tailTip = Offset(cx - dir * u * 3.9f + sin(step * (if (happy) 2f else 1f) + 1f) * u * (if (happy) 1.4f else 0.9f) * dir, bodyY - u * 3.4f)
            val tail = Path().apply {
                moveTo(tailBase.x, tailBase.y)
                quadraticBezierTo(cx - dir * u * 4.2f, bodyY + u * 0.2f, tailTip.x, tailTip.y)
            }
            drawPath(tail, furDark, style = Stroke(width = u * 0.95f, cap = StrokeCap.Round))
            drawCircle(belly, radius = u * 0.5f, center = tailTip)

            // legs: diagonal pairs swing together
            for (k in 0 until 4) {
                val front = k < 2
                val phase = if (k % 2 == 0) swing else -swing
                val hipX = cx + (if (front) dir * u * 1.5f else -dir * u * 1.5f)
                val lift = maxOf(0f, phase) * u * 0.7f
                val foot = Offset(hipX + phase * u * 0.9f * dir, footY - lift - tuck)
                val shade = if (k % 2 == 0) fur else furDark
                drawLine(shade, Offset(hipX, bodyY + u * 0.8f), foot, strokeWidth = u * 0.85f, cap = StrokeCap.Round)
                drawCircle(belly, radius = u * 0.5f, center = Offset(foot.x + dir * u * 0.15f, foot.y))
            }

            // body with belly patch and stripes
            drawOval(fur, topLeft = Offset(cx - u * 2.5f, bodyY - u * 1.4f), size = androidx.compose.ui.geometry.Size(u * 5f, u * 2.9f))
            drawOval(belly, topLeft = Offset(cx - u * 1.5f, bodyY + u * 0.1f), size = androidx.compose.ui.geometry.Size(u * 3f, u * 1.2f))
            for (n in -1..1) {
                drawLine(furDark, Offset(cx + n * u * 0.9f, bodyY - u * 1.35f), Offset(cx + n * u * 0.9f - dir * u * 0.2f, bodyY - u * 0.45f), strokeWidth = u * 0.4f, cap = StrokeCap.Round)
            }

            // ears
            for (side in listOf(-1f, 1f)) {
                val ex = headC.x + side * headR * 0.6f
                val ear = Path().apply {
                    moveTo(ex - headR * 0.45f, headC.y - headR * 0.55f)
                    lineTo(ex + side * headR * 0.15f, headC.y - headR * 1.45f + abs(swing) * u * 0.1f)
                    lineTo(ex + headR * 0.45f, headC.y - headR * 0.55f)
                    close()
                }
                drawPath(ear, fur)
                val inner = Path().apply {
                    moveTo(ex - headR * 0.22f, headC.y - headR * 0.6f)
                    lineTo(ex + side * headR * 0.12f, headC.y - headR * 1.15f)
                    lineTo(ex + headR * 0.22f, headC.y - headR * 0.6f)
                    close()
                }
                drawPath(inner, pink)
            }

            // head
            drawCircle(fur, radius = headR, center = headC)
            drawOval(belly, topLeft = Offset(headC.x + dir * headR * 0.15f - headR * 0.55f, headC.y + headR * 0.1f), size = androidx.compose.ui.geometry.Size(headR * 1.1f, headR * 0.8f))

            // big sparkly eyes with an occasional blink
            val blink = if (stroll > 5.6f && stroll < 5.8f) 0.12f else 1f
            for (side in listOf(-1f, 1f)) {
                val ex = headC.x + side * headR * 0.45f + dir * headR * 0.15f
                val ey = headC.y - headR * 0.1f
                val ew = headR * 0.28f
                val eh = headR * 0.4f * blink
                if (happy) {
                    // closed, smiling eyes: ^ ^
                    drawArc(
                        color = ink, startAngle = 200f, sweepAngle = 140f, useCenter = false,
                        topLeft = Offset(ex - ew * 1.1f, ey - eh * 0.2f),
                        size = androidx.compose.ui.geometry.Size(ew * 2.2f, eh * 1.2f),
                        style = Stroke(width = u * 0.22f, cap = StrokeCap.Round)
                    )
                } else {
                    drawOval(ink, topLeft = Offset(ex - ew, ey - eh), size = androidx.compose.ui.geometry.Size(ew * 2f, eh * 2f))
                }
                if (!happy && blink == 1f) {
                    drawCircle(Color.White, radius = ew * 0.45f, center = Offset(ex - ew * 0.2f, ey - eh * 0.35f))
                    drawCircle(Color.White, radius = ew * 0.2f, center = Offset(ex + ew * 0.3f, ey + eh * 0.35f))
                }
                drawCircle(pink.copy(alpha = 0.6f), radius = headR * 0.18f, center = Offset(ex + side * headR * 0.15f, ey + headR * 0.55f))
            }
            // nose, mouth and whiskers
            val nose = Offset(headC.x + dir * headR * 0.15f, headC.y + headR * 0.38f)
            drawCircle(pink, radius = u * 0.22f, center = nose)
            drawArc(
                color = ink, startAngle = 10f, sweepAngle = 160f, useCenter = false,
                topLeft = Offset(nose.x - u * (if (happy) 0.5f else 0.35f), nose.y + u * 0.1f),
                size = androidx.compose.ui.geometry.Size(u * (if (happy) 1.0f else 0.7f), u * (if (happy) 0.8f else 0.45f)),
                style = Stroke(width = u * 0.15f, cap = StrokeCap.Round)
            )
            for (side in listOf(-1f, 1f)) {
                for (w in -1..1) {
                    drawLine(
                        ink.copy(alpha = 0.6f),
                        Offset(nose.x + side * u * 0.5f, nose.y + w * u * 0.12f),
                        Offset(nose.x + side * u * 1.7f, nose.y + w * u * 0.4f),
                        strokeWidth = u * 0.1f, cap = StrokeCap.Round
                    )
                }
            }

            if (happy) {
                // hearts drift up from her head
                for (d in 0 until 3) {
                    val t = ((step / twoPi) * 0.7f + d / 3f) % 1f
                    val hx = headC.x + (d - 1) * u * 1.3f + sin(t * 6f) * u * 0.3f
                    val hy = headC.y - headR * 1.3f - t * u * 3.2f
                    val r = u * 0.45f * (1f - t * 0.4f)
                    val color = pink.copy(alpha = 1f - t)
                    drawCircle(color, radius = r, center = Offset(hx - r * 0.55f, hy))
                    drawCircle(color, radius = r, center = Offset(hx + r * 0.55f, hy))
                    drawPath(
                        Path().apply {
                            moveTo(hx - r * 1.45f, hy + r * 0.3f)
                            lineTo(hx, hy + r * 1.8f)
                            lineTo(hx + r * 1.45f, hy + r * 0.3f)
                            close()
                        },
                        color
                    )
                }
            } else {
                // "waiting..." dots popping up one after another
                for (d in 0 until 3) {
                    val t = ((stroll * 2f / twoPi * 3f) - d * 0.35f) % 1f
                    val bounce = sin(Math.PI * t.coerceIn(0f, 1f)).toFloat()
                    drawCircle(
                        Gold.copy(alpha = 0.4f + 0.6f * bounce),
                        radius = u * 0.3f,
                        center = Offset(headC.x - u * 0.9f + d * u * 0.9f, headC.y - headR * 1.75f - bounce * u * 0.5f)
                    )
                }
            }
        }
    }
}

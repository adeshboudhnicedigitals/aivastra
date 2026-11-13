package aivastra.nice.interactive.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.zIndex
import aivastra.nice.interactive.ui.components.AppToast
import aivastra.nice.interactive.ui.components.ToastType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import aivastra.nice.interactive.ui.components.GarmentCarousel
import aivastra.nice.interactive.ui.components.OutfitCard
import aivastra.nice.interactive.ui.components.ClearFocusOnDrag
import aivastra.nice.interactive.ui.components.OutfitSearchField
import aivastra.nice.interactive.ui.components.clearFocusOnTap
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import aivastra.nice.interactive.viewmodels.MultiTryOnItemState
import aivastra.nice.interactive.viewmodels.MultiTryOnItemStatus
import aivastra.nice.interactive.viewmodels.MultiTryOnViewModel
import aivastra.nice.interactive.viewmodels.OutfitSelectionViewModel
import aivastra.nice.interactive.viewmodels.matchingSearch
import kotlinx.coroutines.delay

// Countdown the customer sees before picked garments start generating; any change to the
// picks restarts it, and "Cancel" drops the picks that are still waiting.
private const val AUTO_START_SECONDS = 10
// Once the first batch has been sent, later picks only wait this long before starting.
private const val FOLLOW_UP_START_SECONDS = 5
// Most garments a customer can pick per visit to the picker (the "Add more looks" dialog counts
// as a new visit); garments generated before the screen opened don't count.
private const val MAX_GARMENTS = 5

/**
 * Garment picker shown after the customer's photo is already uploaded. Generation starts on
 * its own after a [AUTO_START_SECONDS]-second countdown once the picks stop changing, or
 * immediately via the swipe button. Garments already sent for generation ([generatedItems]) stay checked and are never
 * fired twice — a started job can't be cancelled, so un-picking one wouldn't stop it anyway.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OutfitSelectionPage(
    category: String,
    onBack: () -> Unit = {},
    onUnauthorized: () -> Unit = {},
    onOutfitSelected: (CatalogProduct, List<CatalogProduct>) -> Unit = { _, _ -> },
    generatedItems: List<MultiTryOnItemState> = emptyList(),
    onGenerate: (List<CatalogProduct>) -> Unit = {},
    onViewResults: () -> Unit = {},
    onUploadProductsClick: () -> Unit = {},
    viewModel: OutfitSelectionViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val pullToRefreshState = rememberPullToRefreshState()

    // Every pick is a multi-select (several garments against one photo). Only the picker's
    // style differs: the swipeable carousel by default, or the tile grid via the header icon.
    var isSwipeStyle by remember { mutableStateOf(true) }
    // Picks made since generation last fired; the debounce below drains this list.
    var pendingProducts by remember { mutableStateOf(listOf<CatalogProduct>()) }
    val requestedProducts = remember(generatedItems) { generatedItems.map { it.product } }
    val checkedProducts = remember(requestedProducts, pendingProducts) {
        requestedProducts + pendingProducts.filter { pick -> requestedProducts.none { it.id == pick.id } }
    }
    val context = LocalContext.current
    val currentOnGenerate by rememberUpdatedState(onGenerate)

    // Every pending garment runs its own countdown: productId -> uptime (ms) at which it starts.
    var pendingDeadlines by remember { mutableStateOf(mapOf<String, Long>()) }
    var nowMs by remember { mutableLongStateOf(android.os.SystemClock.uptimeMillis()) }
    // The very first pick on this screen gets the full countdown; every later pick gets the
    // shorter follow-up time, even before the first one has fired.
    var firstPickDone by remember { mutableStateOf(false) }
    // Everything picked on this visit to the screen, including garments whose timer already ran
    // out and were sent. The limit counts this (not just the waiting list, which drains every
    // few seconds), and it starts fresh each time the screen / "Add more looks" dialog opens.
    var pickedIds by remember { mutableStateOf(setOf<String>()) }
    // Garments already generated when this visit began; the whole session is capped at
    // MAX_SESSION_GARMENTS, so this visit may use at most MAX_GARMENTS of what's left.
    val garmentsBeforeVisit = remember { generatedItems.size }
    val maxPicks = minOf(MAX_GARMENTS, (MultiTryOnViewModel.MAX_SESSION_GARMENTS - garmentsBeforeVisit).coerceAtLeast(0))

    var limitMessage by remember { mutableStateOf<String?>(null) }

    val togglePick: (CatalogProduct) -> Unit = { product ->
        if (requestedProducts.none { it.id == product.id }) {
            if (pendingProducts.any { it.id == product.id }) {
                pendingProducts = pendingProducts.filterNot { it.id == product.id }
                pendingDeadlines = pendingDeadlines - product.id
                pickedIds = pickedIds - product.id
            } else if (pickedIds.size >= maxPicks) {
                limitMessage = if (maxPicks == 0) {
                    "Session limit of ${MultiTryOnViewModel.MAX_SESSION_GARMENTS} garments reached"
                } else {
                    "You can add up to $maxPicks garments"
                }
            } else {
                val seconds =
                    if (firstPickDone || requestedProducts.isNotEmpty()) FOLLOW_UP_START_SECONDS else AUTO_START_SECONDS
                firstPickDone = true
                val now = android.os.SystemClock.uptimeMillis()
                nowMs = now
                pendingDeadlines = pendingDeadlines + (product.id to now + seconds * 1000L)
                pendingProducts = pendingProducts + product
                pickedIds = pickedIds + product.id
            }
        }
    }

    LaunchedEffect(category) {
        viewModel.loadCatalog(category)
        pendingProducts = emptyList()
        pendingDeadlines = emptyMap()
        pickedIds = emptySet()
    }

    // Ticks while anything is waiting and starts each garment as soon as its own timer runs out.
    LaunchedEffect(pendingProducts.isNotEmpty()) {
        while (pendingProducts.isNotEmpty()) {
            val now = android.os.SystemClock.uptimeMillis()
            nowMs = now
            val due = pendingProducts.filter { (pendingDeadlines[it.id] ?: 0L) <= now }
            if (due.isNotEmpty()) {
                pendingProducts = pendingProducts.filterNot { p -> due.any { it.id == p.id } }
                pendingDeadlines = pendingDeadlines - due.map { it.id }.toSet()
                currentOnGenerate(due)
            }
            delay(250L)
        }
    }

    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp =
        (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) +
            sdp(R.dimen._10sdp)
    val hasLoadedProducts = uiState.products.isNotEmpty()
    val searchQuery = viewModel.searchQuery
    // Filter once per input change, not on every recomposition or read.
    val visibleProducts = remember(uiState.products, uiState.selectedSubcategoryId, searchQuery) {
        uiState.visibleProducts.matchingSearch(searchQuery)
    }

    // Jewellery is wide (necklaces etc.), so those cards show the whole photo instead of cropping.
    val fitSubcategoryIds = remember(uiState.subcategories) {
        uiState.subcategories
            .filter { sub ->
                listOf("jewel", "necklace", "earring", "bangle", "ring", "pendant", "ornament")
                    .any { sub.name.contains(it, ignoreCase = true) }
            }
            .map { it.id }
            .toSet()
    }

    val focusManager = LocalFocusManager.current
    val gridState = rememberLazyGridState()
    ClearFocusOnDrag(gridState.interactionSource)

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF080808))
            .clearFocusOnTap(focusManager)
    ) {
        Image(
            painter = painterResource(R.drawable.new_app_bg),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        // Limit snackbar; drawn above the content below via zIndex.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .zIndex(10f)
                .navigationBarsPadding()
        ) {
            AppToast(
                visible = limitMessage != null,
                message = limitMessage.orEmpty(),
                type = ToastType.WARNING,
                autoDismissMs = 3000L,
                onDismiss = { limitMessage = null }
            )
        }

        // imePadding keeps the last rows of results above the keyboard; the
        // background image above stays full-bleed.
        Column(modifier = Modifier.fillMaxSize().navigationBarsPadding().imePadding()) {
            Spacer(Modifier.height(statusBarH + sdp(R.dimen._10sdp)))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = sdp(R.dimen._22sdp), end = sdp(R.dimen._18sdp)),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Box(
                    modifier = Modifier
                        .size(sdp(R.dimen._38sdp))
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = {
                                // Picks still counting down would be lost once this screen is gone,
                                // so send them now (clearing first so the timer can't double-fire).
                                if (pendingProducts.isNotEmpty()) {
                                    val picks = pendingProducts
                                    pendingProducts = emptyList()
                                    pendingDeadlines = emptyMap()
                                    onGenerate(picks)
                                }
                                onBack()
                            }
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White,
                        modifier = Modifier.size(sdp(R.dimen._20sdp))
                    )
                }
                AppHeaderLogo()
            }

            Column(
                modifier = Modifier.padding(
                    start = sdp(R.dimen._22sdp),
                    top = sdp(R.dimen._6sdp),
                    end = sdp(R.dimen._18sdp)
                )
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // IntrinsicSize.Min lets the category pill stretch to the title's height.
                    Row(
                        modifier = Modifier.weight(1f).height(IntrinsicSize.Min),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Choose an Outfit",
                            color = Color.White,
                            fontSize = ssp(R.dimen._24ssp),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = PoppinsFamily
                        )
                        Spacer(Modifier.width(sdp(R.dimen._12sdp)))
                        Box(
                            modifier = Modifier
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(8.dp))
                                .border(
                                    sdp(R.dimen._1sdp),
                                    Color(0xFFF1A91F),
                                    RoundedCornerShape(8.dp)
                                )
                                .padding(horizontal = sdp(R.dimen._12sdp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = category.replaceFirstChar { it.uppercase() },
                                color = Color(0xFFF1A91F),
                                fontSize = ssp(R.dimen._12ssp),
                                fontWeight = FontWeight.Medium,
                                fontFamily = PoppinsFamily,
                                maxLines = 1
                            )
                        }
                    }
                    if (hasLoadedProducts) {
                        ViewStyleToggle(
                            isSwipeStyle = isSwipeStyle,
                            onClick = { isSwipeStyle = !isSwipeStyle }
                        )
                    }
                }
                Text(
                    text = "Select up to $maxPicks looks  •  ${pickedIds.size}/$maxPicks selected",
                    color = Color.White.copy(alpha = 0.76f),
                    fontSize = ssp(R.dimen._12ssp),
                    fontWeight = FontWeight.Medium,
                    fontFamily = PoppinsFamily
                )
            }

            if (hasLoadedProducts) {
                OutfitSearchField(
                    query = searchQuery,
                    onQueryChange = viewModel::onSearchQueryChange,
                    modifier = Modifier.padding(
                        start = sdp(R.dimen._22sdp),
                        top = sdp(R.dimen._14sdp),
                        end = sdp(R.dimen._18sdp)
                    )
                )
            }

            PullToRefreshBox(
                isRefreshing = uiState.isRefreshing,
                onRefresh = viewModel::refresh,
                state = pullToRefreshState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                Column(modifier = Modifier.fillMaxSize()) {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = sdp(R.dimen._22sdp)),
                        horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._8sdp)),
                        modifier = Modifier.padding(top = sdp(R.dimen._14sdp))
                    ) {
                        item {
                            val selected = uiState.selectedSubcategoryId == null
                            Text(
                                text = "All",
                                color = if (selected) Color.White else Color.White.copy(alpha = 0.78f),
                                fontSize = ssp(R.dimen._14ssp),
                                fontFamily = PoppinsFamily,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(sdp(R.dimen._10sdp)))
                                    .background(if (selected) Color(0xFF2A1C0E) else Color(0xFF151515))
                                    .border(
                                        sdp(R.dimen._1sdp),
                                        if (selected) Color(0xFFE59B17) else Color.White.copy(alpha = 0.22f),
                                        RoundedCornerShape(sdp(R.dimen._40sdp))
                                    )
                                    .clickable { viewModel.selectSubcategory(null) }
                                    .padding(
                                        horizontal = sdp(R.dimen._15sdp),
                                        vertical = sdp(R.dimen._7sdp)
                                    )
                            )
                        }
                        items(
                            count = uiState.subcategories.size,
                            key = { uiState.subcategories[it].id }
                        ) { index ->
                            val subcategory = uiState.subcategories[index]
                            val selected = subcategory.id == uiState.selectedSubcategoryId
                            Text(
                                text = subcategory.name,
                                color = if (selected) Color.White else Color.White.copy(alpha = 0.78f),
                                fontSize = ssp(R.dimen._14ssp),
                                fontFamily = PoppinsFamily,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                                    .background(if (selected) Color(0xFF2A1C0E) else Color(0xFF151515))
                                    .border(
                                        sdp(R.dimen._1sdp),
                                        if (selected) Color(0xFFE59B17) else Color.White.copy(alpha = 0.22f),
                                        RoundedCornerShape(sdp(R.dimen._50sdp))
                                    )
                                    .clickable { viewModel.selectSubcategory(subcategory.id) }
                                    .padding(
                                        horizontal = sdp(R.dimen._15sdp),
                                        vertical = sdp(R.dimen._7sdp)
                                    )
                            )
                        }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    ) {
                        when {
                            uiState.isLoading && !hasLoadedProducts -> Box(
                                modifier = Modifier.fillMaxSize(),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(
                                    color = Color(0xFFE59B17),
                                    strokeWidth = sdp(R.dimen._2sdp),
                                    modifier = Modifier.size(sdp(R.dimen._32sdp))
                                )
                            }

                            uiState.isUnauthorized -> CatalogMessage(
                                message = uiState.errorMessage ?: "Session expired. Please sign in again.",
                                actionLabel = "Sign In",
                                onAction = onUnauthorized
                            )

                            uiState.errorMessage != null && !hasLoadedProducts -> CatalogMessage(
                                message = uiState.errorMessage.orEmpty(),
                                actionLabel = "Retry",
                                onAction = viewModel::retry
                            )

                            visibleProducts.isEmpty() && searchQuery.isNotBlank() -> CatalogMessage(
                                message = "No outfits match \"${searchQuery.trim()}\".",
                                actionLabel = "Clear Search",
                                onAction = { viewModel.onSearchQueryChange("") }
                            )

                            visibleProducts.isEmpty() -> CatalogMessage(
                                message = "No outfits available in this category.",
                                actionLabel = "Refresh Catalog",
                                onAction = viewModel::retry,
                                secondaryActionLabel = "Upload Product",
                                onSecondaryAction = onUploadProductsClick
                            )

                            isSwipeStyle -> GarmentCarousel(
                                products = visibleProducts,
                                fitSubcategoryIds = fitSubcategoryIds,
                                selected = checkedProducts,
                                onToggle = togglePick,
                                onRemove = { product ->
                                    if (pendingProducts.any { it.id == product.id }) togglePick(product)
                                },
                                canAddMore = pickedIds.size < maxPicks,
                                actionLabel = if (pendingProducts.isNotEmpty()) "Try On (${pendingProducts.size})" else "View Looks",
                                onAction = {
                                    if (pendingProducts.isNotEmpty()) {
                                        val picks = pendingProducts
                                        pendingProducts = emptyList()
                                        pendingDeadlines = emptyMap()
                                        onGenerate(picks)
                                    }
                                    onViewResults()
                                }
                            )

                            else -> LazyVerticalGrid(
                                state = gridState,
                                columns = GridCells.Fixed(3),
                                contentPadding = PaddingValues(
                                    horizontal = sdp(R.dimen._20sdp),
                                    vertical = sdp(R.dimen._14sdp)
                                ),
                                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                                verticalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                                modifier = Modifier.fillMaxSize()
                            ) {
                                items(visibleProducts, key = { it.id }) { product ->
                                    val isSelected = checkedProducts.any { it.id == product.id }
                                    OutfitCard(
                                        thumbnailUrl = product.mannequinResultUrl
                                            ?: product.imageUrl
                                            ?: product.thumbnailUrl,
                                        contentDescription = product.label ?: "Outfit",
                                        accent = Color(0xFF9E7656),
                                        showSelectionCheckmark = true,
                                        isSelected = isSelected,
                                        onClick = { togglePick(product) }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (checkedProducts.isNotEmpty()) {
                val totalCount = generatedItems.size
                val readyCount = generatedItems.count { it.status == MultiTryOnItemStatus.COMPLETED }
                val isGenerating = generatedItems.any {
                    it.status == MultiTryOnItemStatus.QUEUED || it.status == MultiTryOnItemStatus.PROCESSING
                }
                val hasPending = pendingProducts.isNotEmpty()

                Column(
                    modifier = Modifier.padding(
                        horizontal = sdp(R.dimen._22sdp),
                        vertical = sdp(R.dimen._10sdp)
                    )
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (isGenerating && !hasPending) {
                            CircularProgressIndicator(
                                color = Color(0xFFE59B17),
                                strokeWidth = sdp(R.dimen._2sdp),
                                modifier = Modifier.size(sdp(R.dimen._14sdp))
                            )
                            Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        }
                        Text(
                            text = when {
                                hasPending -> "Each look starts on its own timer — or tap Try On to start all now"
                                isGenerating -> "Generating your looks — $readyCount of $totalCount ready"
                                else -> "$readyCount of $totalCount looks ready"
                            },
                            color = Color.White.copy(alpha = 0.76f),
                            fontSize = ssp(R.dimen._12ssp),
                            fontWeight = FontWeight.Medium,
                            fontFamily = PoppinsFamily,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        if (hasPending) {
                            Spacer(Modifier.width(sdp(R.dimen._10sdp)))
                            Text(
                                text = "Cancel",
                                color = Color(0xFFE59B17),
                                fontSize = ssp(R.dimen._12ssp),
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = PoppinsFamily,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                                    .border(
                                        sdp(R.dimen._1sdp),
                                        Color(0xFFE59B17),
                                        RoundedCornerShape(sdp(R.dimen._40sdp))
                                    )
                                    // Drops only the picks still waiting; garments already
                                    // sent for generation stay as they are.
                                    .clickable { pendingProducts = emptyList(); pendingDeadlines = emptyMap() }
                                    .padding(horizontal = sdp(R.dimen._12sdp), vertical = sdp(R.dimen._4sdp))
                            )
                        }
                    }
                    Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._6sdp))
                        ) {
                            pendingProducts.forEach { product ->
                                val secs = (((pendingDeadlines[product.id] ?: nowMs) - nowMs + 999L) / 1000L)
                                    .toInt().coerceAtLeast(0)
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                                        .border(
                                            sdp(R.dimen._1sdp),
                                            Color(0xFFE59B17),
                                            RoundedCornerShape(sdp(R.dimen._40sdp))
                                        )
                                        // Cancels just this garment.
                                        .clickable { togglePick(product) }
                                        .padding(horizontal = sdp(R.dimen._10sdp), vertical = sdp(R.dimen._4sdp))
                                ) {
                                    Text(
                                        text = "${product.label ?: "Look"} · ${secs}s  ✕",
                                        color = Color(0xFFE59B17),
                                        fontSize = ssp(R.dimen._11ssp),
                                        fontWeight = FontWeight.SemiBold,
                                        fontFamily = PoppinsFamily,
                                        maxLines = 1
                                    )
                                }
                            }
                        }
                        if (!(isSwipeStyle && visibleProducts.isNotEmpty())) {
                        Spacer(Modifier.width(sdp(R.dimen._10sdp)))
                        Text(
                            text = if (hasPending) "Try On (${pendingProducts.size})" else "View Looks",
                            color = Color.Black,
                            fontSize = ssp(R.dimen._12ssp),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = PoppinsFamily,
                            maxLines = 1,
                            modifier = Modifier
                                .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                                .background(Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
                                .clickable {
                                    if (hasPending) {
                                        val picks = pendingProducts
                                        // Clearing first cancels the pending auto-start so it can't double-fire.
                                        pendingProducts = emptyList()
                                        pendingDeadlines = emptyMap()
                                        onGenerate(picks)
                                    }
                                    onViewResults()
                                }
                                .padding(horizontal = sdp(R.dimen._18sdp), vertical = sdp(R.dimen._9sdp))
                        )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Switches the picker between its two multi-select styles. The icon shows the style you
 * would switch *to*: tiles while swiping, the carousel while on tiles.
 */
@Composable
private fun ViewStyleToggle(
    isSwipeStyle: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val label = if (isSwipeStyle) "Switch to tile view" else "Switch to swipe view"
    Box(
        modifier = modifier
            .size(sdp(R.dimen._38sdp))
            .clip(CircleShape)
            .background(Color(0xFF2A1C0E))
            .border(sdp(R.dimen._1sdp), Color(0xFFE59B17), CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick
            )
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) {
        Crossfade(targetState = isSwipeStyle, label = "viewStyleIcon") { swipe ->
            Canvas(modifier = Modifier.size(sdp(R.dimen._18sdp))) {
                val tint = Color(0xFFE59B17)
                if (swipe) {
                    // 2 x 2 tiles
                    val gap = size.width * 0.14f
                    val cell = (size.width - gap) / 2f
                    val corner = CornerRadius(cell * 0.25f)
                    for (row in 0..1) for (col in 0..1) {
                        drawRoundRect(
                            color = tint,
                            topLeft = Offset(col * (cell + gap), row * (cell + gap)),
                            size = Size(cell, cell),
                            cornerRadius = corner
                        )
                    }
                } else {
                    // centre card flanked by two peeking cards
                    val centreW = size.width * 0.5f
                    val sideW = size.width * 0.17f
                    val gap = (size.width - centreW - 2 * sideW) / 2f
                    drawRoundRect(
                        color = tint,
                        topLeft = Offset(sideW + gap, 0f),
                        size = Size(centreW, size.height),
                        cornerRadius = CornerRadius(size.width * 0.1f)
                    )
                    for (x in listOf(0f, size.width - sideW)) {
                        drawRoundRect(
                            color = tint.copy(alpha = 0.6f),
                            topLeft = Offset(x, size.height * 0.2f),
                            size = Size(sideW, size.height * 0.6f),
                            cornerRadius = CornerRadius(size.width * 0.07f)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CatalogMessage(
    message: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
    secondaryActionLabel: String? = null,
    onSecondaryAction: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(sdp(R.dimen._32sdp)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = message,
            color = Color.White.copy(alpha = 0.7f),
            fontSize = ssp(R.dimen._12ssp),
            fontFamily = PoppinsFamily
        )
        if (actionLabel != null) {
            Spacer(Modifier.height(sdp(R.dimen._12sdp)))
            Text(
                text = actionLabel,
                color = Color(0xFFE59B17),
                fontWeight = FontWeight.SemiBold,
                fontFamily = PoppinsFamily,
                modifier = Modifier
                    .clip(RoundedCornerShape(sdp(R.dimen._50sdp)))
                    .border(
                        sdp(R.dimen._1sdp),
                        Color(0xFFE59B17),
                        RoundedCornerShape(sdp(R.dimen._50sdp))
                    )
                    .clickable(onClick = onAction)
                    .padding(horizontal = sdp(R.dimen._20sdp), vertical = sdp(R.dimen._8sdp))
            )
        }
        if (secondaryActionLabel != null) {
            Spacer(Modifier.height(sdp(R.dimen._12sdp)))
            Text(
                text = secondaryActionLabel,
                color = Color.Black,
                fontWeight = FontWeight.SemiBold,
                fontFamily = PoppinsFamily,
                modifier = Modifier
                    .clip(RoundedCornerShape(sdp(R.dimen._50sdp)))
                    .background(Color.White)
                    .clickable(onClick = onSecondaryAction)
                    .padding(horizontal = sdp(R.dimen._20sdp), vertical = sdp(R.dimen._8sdp))
            )
        }
    }
}

@Preview(showBackground = true, widthDp = 420, heightDp = 780)
@Composable
private fun OutfitSelectionPagePreview() {
    AiVastraTheme { OutfitSelectionPage(category = "women") }
}

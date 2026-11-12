package aivastra.nice.interactive.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import coil.compose.AsyncImage
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.models.GarmentSubcategory
import aivastra.nice.interactive.data.repository.CatalogRepository
import aivastra.nice.interactive.data.repository.CatalogResult
import aivastra.nice.interactive.ui.components.ClearFocusOnDrag
import aivastra.nice.interactive.ui.components.ExitSessionDialog
import aivastra.nice.interactive.ui.components.ZoomableImageGallery
import aivastra.nice.interactive.ui.components.clearFocusOnTap
import aivastra.nice.interactive.ui.components.OutfitSearchField
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import aivastra.nice.interactive.viewmodels.matchingSearch
import kotlinx.coroutines.launch

@Composable
fun TryMoreOutfitsPage(
    initialCategory: String = "women",
    initialProduct: CatalogProduct?,
    resultImageUrl: String? = null,
    sessionHistory: List<String> = emptyList(),
    // Parallel to sessionHistory; used so the gallery QR points at the kiosk-download page.
    sessionJobIds: List<String> = emptyList(),
    onUnauthorized: () -> Unit = {},
    onGoHome: () -> Unit = {},
    onGoToDownloads: () -> Unit,
    onRetake: () -> Unit = {},
    onSelectOutfitDetail: (CatalogProduct, List<CatalogProduct>) -> Unit,
    onTryLook: (CatalogProduct) -> Unit,
    // True while a "Try Another" pick is generating in the background — shown as a small
    // non-blocking badge instead of leaving this screen, so already generated looks stay
    // visible/swipeable the whole time.
    isGeneratingNewLook: Boolean = false,
    // Hides garments already in play elsewhere (e.g. already in the multi-generation grid)
    // so the same one can't be picked twice. Empty by default — no effect on normal browsing.
    excludedProductIds: Set<String> = emptySet(),
    modifier: Modifier = Modifier
) {
    var showSessionGallery by remember { mutableStateOf(false) }
    // Top-left is Home (not Back) on this screen — there's no single "back" destination that
    // makes sense once the customer is browsing outfits, so every exit path (button tap or the
    // system back gesture) goes through the same confirmation dialog instead.
    var showExitDialog by remember { mutableStateOf(false) }

    BackHandler(enabled = showSessionGallery) { showSessionGallery = false }
    BackHandler(enabled = !showSessionGallery) { showExitDialog = true }

    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    var subcategories by remember { mutableStateOf<List<GarmentSubcategory>>(emptyList()) }
    var selectedSubcategory by remember { mutableStateOf<GarmentSubcategory?>(null) }
    var allProducts by remember { mutableStateOf<List<CatalogProduct>>(emptyList()) }
    var searchQuery by remember { mutableStateOf("") }
    // The dropdown has no "All" entry, so the subcategory is parked here while a
    // search widens the list to the whole category, and put back when it's cleared.
    var subcategoryBeforeSearch by remember { mutableStateOf<GarmentSubcategory?>(null) }
    // Derived, not stored: filter once per input change rather than on every read.
    val displayProducts = remember(allProducts, selectedSubcategory, searchQuery, excludedProductIds) {
        val inSubcategory = selectedSubcategory?.let { sub ->
            allProducts.filter { it.subcategoryId == sub.id }
        } ?: allProducts
        inSubcategory.filterNot { it.id in excludedProductIds }.matchingSearch(searchQuery)
    }
    var selectedProduct by remember { mutableStateOf(initialProduct) }
    var userHasChangedProduct by remember { mutableStateOf(false) }

    // Position within this photo-upload session's generated results (sessionHistory),
    // defaulting to whichever entry matches the just-completed result.
    var historyIndex by remember {
        mutableStateOf(
            sessionHistory.indexOf(resultImageUrl).takeIf { it >= 0 }
                ?: (sessionHistory.size - 1).coerceAtLeast(0)
        )
    }

    // A "Try Another" pick generates in the background while staying on this screen — once
    // it lands (sessionHistory actually grows during this screen's lifetime, as opposed to
    // just on first mount), snap the featured image to it so the new look visibly "pops in"
    // instead of silently appearing only once the customer happens to swipe to it.
    var lastSeenHistorySize by remember { mutableIntStateOf(sessionHistory.size) }
    LaunchedEffect(sessionHistory.size) {
        if (sessionHistory.size > lastSeenHistorySize) {
            historyIndex = sessionHistory.lastIndex
        }
        lastSeenHistorySize = sessionHistory.size
    }

    // Hoisted so both the featured-image card and the expand-to-fullscreen trigger below
    // read the exact same "what's currently shown" value instead of recomputing it twice.
    val displayUrl = if (sessionHistory.isNotEmpty()) {
        sessionHistory.getOrNull(historyIndex) ?: resultImageUrl
    } else if (!userHasChangedProduct && !resultImageUrl.isNullOrBlank()) {
        resultImageUrl
    } else {
        selectedProduct?.mannequinResultUrl
            ?: selectedProduct?.imageUrl
            ?: selectedProduct?.thumbnailUrl
            ?: resultImageUrl
    }
    // Full-screen gallery falls back to just the single currently-displayed image when there's
    // no multi-result session history yet (e.g. viewing the very first generated result).
    val overlayImages = sessionHistory.ifEmpty { listOfNotNull(displayUrl) }

    var isLoading by remember { mutableStateOf(true) }
    var isDropdownExpanded by remember { mutableStateOf(false) }

    val repository = remember { CatalogRepository() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    ClearFocusOnDrag(listState.interactionSource)

    LaunchedEffect(initialCategory) {
        isLoading = true
        when (val result = repository.getCatalog(initialCategory)) {
            is CatalogResult.Success -> {
                subcategories = result.data.subcategories
                allProducts = result.data.products

                val matchedSubcategory = if (initialProduct != null) {
                    subcategories.firstOrNull { it.id == initialProduct.subcategoryId } ?: subcategories.firstOrNull()
                } else {
                    subcategories.firstOrNull()
                }

                selectedSubcategory = matchedSubcategory
                val initialProducts = if (matchedSubcategory != null) {
                    allProducts.filter { it.subcategoryId == matchedSubcategory.id }
                } else {
                    allProducts
                }

                if (selectedProduct == null || initialProducts.none { it.id == selectedProduct?.id }) {
                    selectedProduct = initialProducts.firstOrNull()
                }

                isLoading = false
            }
            is CatalogResult.Failure -> {
                isLoading = false
                if (result.isUnauthorized) {
                    onUnauthorized()
                }
            }
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090807))
            .clearFocusOnTap(focusManager)
            // Lifts the list and the bottom action bar above the keyboard.
            .imePadding()
            .padding(
                start = sdp(R.dimen._18sdp),
                end = sdp(R.dimen._18sdp),
                top = statusBarH + sdp(R.dimen._10sdp),
                bottom = sdp(R.dimen._34sdp) + navBarH
            )
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // ── Top Header Bar (Back Arrow + Logo) ─────────────────────────────
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
                            onClick = { showExitDialog = true }
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

            if (isGeneratingNewLook) {
                Spacer(Modifier.height(sdp(R.dimen._10sdp)))
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                        .background(Color(0xFF24180D))
                        .border(sdp(R.dimen._1sdp), Color(0xFF6B471C), RoundedCornerShape(sdp(R.dimen._40sdp)))
                        .padding(horizontal = sdp(R.dimen._14sdp), vertical = sdp(R.dimen._8sdp)),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(
                        color = Color(0xFFE59B17),
                        strokeWidth = sdp(R.dimen._2sdp),
                        modifier = Modifier.size(sdp(R.dimen._14sdp))
                    )
                    Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                    Text(
                        text = "Generating new look…",
                        color = Color.White.copy(alpha = 0.85f),
                        fontSize = ssp(R.dimen._12ssp),
                        fontWeight = FontWeight.Medium,
                        fontFamily = PoppinsFamily
                    )
                }
            }

            Spacer(Modifier.height(sdp(R.dimen._10sdp)))

            // ── Middle Section: Featured Image Card + Right Outfits Selector ────
            if (isLoading) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = Color(0xFFE7A52C))
                }
            } else {
                BoxWithConstraints(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    val screenW = maxWidth
                    val isMobile = screenW < 500.dp
                    val rightWeight = if (isMobile) 0.35f else 0.28f
                    val leftWeight = 1f - rightWeight
                    val thumbnailH = if (isMobile) sdp(R.dimen._180sdp) else sdp(R.dimen._250sdp)

                    Row(
                        modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp))
                    ) {
                        // Left: Large Featured Image Card
                        Box(
                            modifier = Modifier
                                .weight(leftWeight)
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(sdp(R.dimen._16sdp)))
                                .background(Color(0xFF161514))
                                .border(
                                    width = sdp(R.dimen._1sdp),
                                    color = Color(0xFFE7A52C).copy(alpha = 0.5f),
                                    shape = RoundedCornerShape(sdp(R.dimen._16sdp))
                                )
                                .clickable {
                                    if (sessionHistory.isNotEmpty()) {
                                        showSessionGallery = true
                                    } else {
                                        selectedProduct?.let { product ->
                                            onSelectOutfitDetail(product, displayProducts)
                                        }
                                    }
                                }
                        ) {
                            if (displayUrl != null) {
                                AsyncImage(
                                    model = displayUrl,
                                    contentDescription = selectedProduct?.label,
                                    contentScale = ContentScale.Crop,
                                    alignment = Alignment.TopCenter,
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            // Expand-to-fullscreen — top-right corner, clear of the bottom-start
                            // session history controls (prev/next arrow + dot indicators).
                            if (displayUrl != null) {
                                Box(
                                    modifier = Modifier
                                        .padding(top = sdp(R.dimen._10sdp), end = sdp(R.dimen._12sdp))
                                        .size(sdp(R.dimen._32sdp))
                                        .align(Alignment.TopEnd)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = 0.55f))
                                        .border(sdp(R.dimen._1sdp), Color.White.copy(alpha = 0.35f), CircleShape)
                                        .clickable { showSessionGallery = true },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        painter = painterResource(R.drawable.ic_expand),
                                        contentDescription = "View full screen",
                                        tint = Color.White,
                                        modifier = Modifier.size(sdp(R.dimen._16sdp))
                                    )
                                }
                            }

                            // Session history navigation: previous/next generated result + dot indicators
                            if (sessionHistory.size > 1) {
                                val historySize = sessionHistory.size
                                Box(
                                    modifier = Modifier
                                        .padding(start = sdp(R.dimen._12sdp), bottom = sdp(R.dimen._10sdp))
                                        .size(sdp(R.dimen._36sdp))
                                        .align(Alignment.BottomStart)
                                        .clip(CircleShape)
                                        .background(
                                            Brush.linearGradient(
                                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                                            )
                                        )
                                        .clickable {
                                            historyIndex = if (historyIndex - 1 < 0) historySize - 1 else historyIndex - 1
                                        },
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
                                        .padding(end = sdp(R.dimen._12sdp), bottom = sdp(R.dimen._10sdp))
                                        .size(sdp(R.dimen._36sdp))
                                        .align(Alignment.BottomEnd)
                                        .clip(CircleShape)
                                        .background(
                                            Brush.linearGradient(
                                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                                            )
                                        )
                                        .clickable {
                                            historyIndex = (historyIndex + 1) % historySize
                                        },
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
                                        .padding(bottom = sdp(R.dimen._10sdp)),
                                    horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._6sdp)),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    sessionHistory.indices.forEach { index ->
                                        val isActive = index == historyIndex
                                        Box(
                                            modifier = Modifier
                                                .size(if (isActive) sdp(R.dimen._8sdp) else sdp(R.dimen._6sdp))
                                                .clip(CircleShape)
                                                .background(
                                                    if (isActive) Color(0xFFE7A52C) else Color.White.copy(alpha = 0.4f)
                                                )
                                                .clickable { historyIndex = index }
                                        )
                                    }
                                }
                            }
                        }

                        // Right: Subcategory Dropdown & Thumbnail Selector Container
                        Column(
                            modifier = Modifier
                                .weight(rightWeight)
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(sdp(R.dimen._16sdp)))
                                .background(Color(0xFF141210))
                                .border(
                                    width = sdp(R.dimen._1sdp),
                                    color = Color(0xFF5C3C18).copy(alpha = 0.8f),
                                    shape = RoundedCornerShape(sdp(R.dimen._16sdp))
                                )
                                .padding(sdp(R.dimen._8sdp)),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            // Subcategory Dropdown Selector Button
                            Box(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(sdp(R.dimen._40sdp))
                                        .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
                                        .background(Color(0xFF24180D))
                                        .border(
                                            width = sdp(R.dimen._1sdp),
                                            color = Color(0xFF6B471C),
                                            shape = RoundedCornerShape(sdp(R.dimen._8sdp))
                                        )
                                        .clickable { isDropdownExpanded = true }
                                        .padding(horizontal = sdp(R.dimen._8sdp)),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = selectedSubcategory?.name
                                            ?: if (searchQuery.isNotBlank()) "All" else "Western",
                                        color = Color.White,
                                        fontSize = if (isMobile) ssp(R.dimen._11ssp) else ssp(R.dimen._13ssp),
                                        fontWeight = FontWeight.Bold,
                                        fontFamily = PoppinsFamily,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Spacer(Modifier.width(sdp(R.dimen._4sdp)))
                                    Icon(
                                        Icons.Default.KeyboardArrowDown,
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(sdp(R.dimen._16sdp))
                                    )
                                }

                                DropdownMenu(
                                    expanded = isDropdownExpanded,
                                    onDismissRequest = { isDropdownExpanded = false },
                                    modifier = Modifier
                                        .background(Color(0xFF24180D))
                                        .border(
                                            width = sdp(R.dimen._1sdp),
                                            color = Color(0xFF6B471C),
                                            shape = RoundedCornerShape(sdp(R.dimen._8sdp))
                                        )
                                ) {
                                    subcategories.forEach { sub ->
                                        DropdownMenuItem(
                                            text = {
                                                Text(
                                                    sub.name,
                                                    color = Color.White,
                                                    fontSize = ssp(R.dimen._12ssp),
                                                    fontWeight = FontWeight.SemiBold,
                                                    fontFamily = PoppinsFamily
                                                )
                                            },
                                            contentPadding = PaddingValues(horizontal = sdp(R.dimen._12sdp), vertical = sdp(R.dimen._8sdp)),
                                            onClick = {
                                                selectedSubcategory = sub
                                                isDropdownExpanded = false
                                            }
                                        )
                                    }
                                }
                            }

                            Spacer(Modifier.height(sdp(R.dimen._8sdp)))

                            OutfitSearchField(
                                query = searchQuery,
                                onQueryChange = { query ->
                                    if (searchQuery.isBlank() && query.isNotBlank()) {
                                        subcategoryBeforeSearch = selectedSubcategory
                                        selectedSubcategory = null
                                    } else if (query.isBlank() && selectedSubcategory == null) {
                                        selectedSubcategory = subcategoryBeforeSearch
                                    }
                                    searchQuery = query
                                    scope.launch { listState.scrollToItem(0) }
                                },
                                placeholder = "Search",
                                shape = RoundedCornerShape(sdp(R.dimen._8sdp)),
                                containerColor = Color(0xFF24180D),
                                idleBorderColor = Color(0xFF6B471C),
                                contentPadding = PaddingValues(
                                    horizontal = sdp(R.dimen._8sdp),
                                    vertical = sdp(R.dimen._9sdp)
                                )
                            )

                            Spacer(Modifier.height(sdp(R.dimen._8sdp)))

                            // Outfit Thumbnail Cards List
                            Box(modifier = Modifier.weight(1f)) {
                                if (displayProducts.isEmpty() && searchQuery.isNotBlank()) {
                                    Text(
                                        text = "No outfits match",
                                        color = Color.White.copy(alpha = 0.7f),
                                        fontSize = ssp(R.dimen._11ssp),
                                        fontFamily = PoppinsFamily,
                                        modifier = Modifier
                                            .align(Alignment.TopCenter)
                                            .padding(top = sdp(R.dimen._12sdp))
                                    )
                                }
                                LazyColumn(
                                    state = listState,
                                    modifier = Modifier.fillMaxSize(),
                                    verticalArrangement = Arrangement.spacedBy(sdp(R.dimen._8sdp))
                                ) {
                                    items(displayProducts) { product ->
                                        val isSelected = product.id == selectedProduct?.id
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(thumbnailH)
                                                .clip(RoundedCornerShape(sdp(R.dimen._12sdp)))
                                                .background(Color.Black)
                                                .border(
                                                    width = if (isSelected) sdp(R.dimen._2sdp) else sdp(R.dimen._1sdp),
                                                    color = if (isSelected) Color(0xFFE7A52C) else Color(0xFF3B2A18),
                                                    shape = RoundedCornerShape(sdp(R.dimen._12sdp))
                                                )
                                                .clickable {
                                                    selectedProduct = product
                                                    userHasChangedProduct = true
                                                    onSelectOutfitDetail(product, displayProducts)
                                                }
                                        ) {
                                            AsyncImage(
                                                model = product.mannequinResultUrl
                                                    ?: product.imageUrl
                                                    ?: product.thumbnailUrl,
                                                contentDescription = product.label,
                                                contentScale = ContentScale.Crop,
                                                alignment = Alignment.TopCenter,
                                                modifier = Modifier.fillMaxSize()
                                            )

                                        // Selected Outfit Gold Checkmark Badge
                                        if (isSelected) {
                                            Box(
                                                modifier = Modifier
                                                    .padding(sdp(R.dimen._6sdp))
                                                    .size(sdp(R.dimen._20sdp))
                                                    .clip(CircleShape)
                                                    .background(Color(0xFFE7A52C))
                                                    .align(Alignment.TopEnd),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(
                                                    Icons.Default.Check,
                                                    contentDescription = "Selected",
                                                    tint = Color.Black,
                                                    modifier = Modifier.size(sdp(R.dimen._14sdp))
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(sdp(R.dimen._4sdp)))

                        // Up & Down Scroll Buttons
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = sdp(R.dimen._4sdp)),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(sdp(R.dimen._24sdp))
                                    .clip(CircleShape)
                                    .background(Color(0xFF5C3C18))
                                    .clickable {
                                        scope.launch {
                                            listState.animateScrollToItem(
                                                (listState.firstVisibleItemIndex - 1).coerceAtLeast(0)
                                            )
                                        }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.KeyboardArrowUp,
                                    contentDescription = "Scroll Up",
                                    tint = Color.White,
                                    modifier = Modifier.size(sdp(R.dimen._16sdp))
                                )
                            }
                            Spacer(Modifier.width(sdp(R.dimen._10sdp)))
                            Box(
                                modifier = Modifier
                                    .size(sdp(R.dimen._24sdp))
                                    .clip(CircleShape)
                                    .background(Color(0xFFE7A52C))
                                    .clickable {
                                        scope.launch {
                                            listState.animateScrollToItem(
                                                (listState.firstVisibleItemIndex + 1).coerceAtMost(
                                                    (displayProducts.size - 1).coerceAtLeast(0)
                                                )
                                            )
                                        }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.KeyboardArrowDown,
                                    contentDescription = "Scroll Down",
                                    tint = Color.Black,
                                    modifier = Modifier.size(sdp(R.dimen._16sdp))
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(sdp(R.dimen._12sdp)))

            // ── Bottom Action Controls Bar ────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left Button: "Go To Downloads →"
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._50sdp))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(Color.White)
                        .clickable(onClick = onGoToDownloads),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = "Go To Downloads",
                            color = Color(0xFF7E3D00),
                            fontSize = ssp(R.dimen._14ssp),
                            fontWeight = FontWeight.Bold,
                            fontFamily = PoppinsFamily
                        )
                        Spacer(Modifier.width(sdp(R.dimen._6sdp)))
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            tint = Color(0xFF7E3D00),
                            modifier = Modifier.size(sdp(R.dimen._18sdp))
                        )
                    }
                }

                // Right Button: "✨ Try this Look"
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._50sdp))
                        .clip(RoundedCornerShape(sdp(R.dimen._14sdp)))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFF8B5E27), Color(0xFF4A2F0F))
                            )
                        )
                        .clickable {
                            selectedProduct?.let { onTryLook(it) }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Star,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._18sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        Text(
                            text = "Try this Look",
                            color = Color.White,
                            fontSize = ssp(R.dimen._14ssp),
                            fontWeight = FontWeight.Bold,
                            fontFamily = PoppinsFamily
                        )
                    }
                }
            }
        }
    }

        if (showSessionGallery && overlayImages.isNotEmpty()) {
            ZoomableImageGallery(
                images = overlayImages,
                // Only meaningful when overlayImages is the session history itself.
                jobIds = if (sessionHistory.isNotEmpty()) sessionJobIds else emptyList(),
                currentIndex = historyIndex.coerceIn(0, overlayImages.lastIndex),
                onIndexChange = { historyIndex = it },
                onClose = { showSessionGallery = false },
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
    }
}

@Preview(name = "Try More Outfits - Phone", showBackground = true, widthDp = 375, heightDp = 667)
@Composable
private fun TryMoreOutfitsPagePreview() {
    AiVastraTheme {
        TryMoreOutfitsPage(
            initialProduct = null,
            onGoToDownloads = {},
            onSelectOutfitDetail = { _, _ -> },
            onTryLook = {}
        )
    }
}


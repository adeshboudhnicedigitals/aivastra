package aivastra.nice.interactive.ui.screens

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.components.OutfitCard
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.viewmodels.OutfitSelectionViewModel
import aivastra.nice.interactive.data.models.CatalogProduct

import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp

@Composable
fun OutfitSelectionPage(
    category: String,
    onBack: () -> Unit = {},
    onOutfitSelected: (CatalogProduct, List<CatalogProduct>) -> Unit = { _, _ -> },
    viewModel: OutfitSelectionViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(category) {
        viewModel.loadCatalog(category)
    }

    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)

    Box(modifier = modifier.fillMaxSize() .background(Color(0xFF080808))) {
        Image(
            painter = painterResource(R.drawable.new_app_bg),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        Column(modifier = Modifier.fillMaxSize()) {
            Spacer(Modifier.height(statusBarH + sdp(R.dimen._10sdp)))
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = sdp(R.dimen._22sdp), end = sdp(R.dimen._18sdp)),
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
                            onClick = onBack
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White, modifier = Modifier.size(sdp(R.dimen._20sdp)))
                }
                AppHeaderLogo()
            }

            Column(modifier = Modifier.padding(start = sdp(R.dimen._22sdp), top = sdp(R.dimen._20sdp), end = sdp(R.dimen._18sdp))) {
                Text(
                    "${category.replaceFirstChar { it.uppercase() }} ✦",
                    color = Color(0xFFF1A91F),
                    fontSize = ssp(R.dimen._12ssp),
                    fontWeight = FontWeight.Medium,
                    fontFamily = PoppinsFamily
                )
                Spacer(Modifier.height(sdp(R.dimen._5sdp)))
                Text(
                    "Choose an Outfit",
                    color = Color.White,
                    fontSize = ssp(R.dimen._24ssp),
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = PoppinsFamily
                )
                Text(
                    "Explore our wide range of styles",
                    color = Color.White.copy(alpha = 0.76f),
                    fontSize = ssp(R.dimen._12ssp),
                    fontWeight = FontWeight.Medium,
                    fontFamily = PoppinsFamily
                )
            }

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
                            .padding(horizontal = sdp(R.dimen._15sdp), vertical = sdp(R.dimen._7sdp))
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
                            .padding(horizontal = sdp(R.dimen._15sdp), vertical = sdp(R.dimen._7sdp))
                    )
                }
            }

            when {
                uiState.isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(
                        color = Color(0xFFE59B17),
                        strokeWidth = sdp(R.dimen._2sdp),
                        modifier = Modifier.size(sdp(R.dimen._32sdp))
                    )
                }

                uiState.errorMessage != null -> CatalogMessage(
                    message = uiState.errorMessage.orEmpty(),
                    actionLabel = "Retry",
                    onAction = viewModel::retry
                )

                uiState.visibleProducts.isEmpty() -> CatalogMessage(
                    message = "No outfits available in this category."
                )

                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(horizontal = sdp(R.dimen._20sdp), vertical = sdp(R.dimen._14sdp)),
                    horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                    verticalArrangement = Arrangement.spacedBy(sdp(R.dimen._14sdp)),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(uiState.visibleProducts, key = { it.id }) { product ->
                        OutfitCard(
                            thumbnailUrl = product.thumbnailUrl ?: product.imageUrl,
                            contentDescription = product.label ?: "Outfit",
                            accent = Color(0xFF9E7656),
                            onClick = { onOutfitSelected(product, uiState.visibleProducts) }
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
    onAction: () -> Unit = {}
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(sdp(R.dimen._32sdp)),
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
                    .border(sdp(R.dimen._1sdp), Color(0xFFE59B17), RoundedCornerShape(sdp(R.dimen._50sdp)))
                    .clickable(onClick = onAction)
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

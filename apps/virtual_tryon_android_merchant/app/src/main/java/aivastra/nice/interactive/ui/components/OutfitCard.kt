package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import aivastra.nice.interactive.R
import aivastra.nice.interactive.utils.sdp
import coil.compose.AsyncImage

/**
 * Small, stateless card used by outfit grids. Keeping the card independent makes
 * it easy to replace placeholder images with API or resource-backed outfits.
 *
 * [showSelectionCheckmark] opts into the multi-select badge/border without affecting
 * any existing single-select call site, which never passes it.
 */
@Composable
fun OutfitCard(
    thumbnailUrl: String?,
    contentDescription: String,
    accent: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    showSelectionCheckmark: Boolean = false,
    isSelected: Boolean = false
) {
    val shape = RoundedCornerShape(sdp(R.dimen._10sdp))
    val interactionSource = remember { MutableInteractionSource() }

    Box(
        modifier = modifier
            .aspectRatio(0.72f)
            .clip(shape)
            .background(
                Brush.radialGradient(
                    colors = listOf(
                        accent.copy(alpha = 0.25f),
                        Color(0xFFB18E6E)
                    ),
                    radius = 520f
                )
            )
            .then(
                if (isSelected) {
                    Modifier.border(sdp(R.dimen._2sdp), Color(0xFFE7A52C), shape)
                } else {
                    Modifier
                }
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
    ) {
        AsyncImage(
            model = thumbnailUrl,
            contentDescription = contentDescription,
            contentScale = ContentScale.FillBounds,
            alignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .clip(shape)
        )

        if (showSelectionCheckmark) {
            Box(
                modifier = Modifier
                    .padding(sdp(R.dimen._6sdp))
                    .size(sdp(R.dimen._20sdp))
                    .clip(CircleShape)
                    .background(if (isSelected) Color(0xFFE7A52C) else Color.Black.copy(alpha = 0.45f))
                    .border(
                        sdp(R.dimen._1sdp),
                        if (isSelected) Color(0xFFE7A52C) else Color.White.copy(alpha = 0.6f),
                        CircleShape
                    )
                    .align(Alignment.TopEnd),
                contentAlignment = Alignment.Center
            ) {
                if (isSelected) {
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

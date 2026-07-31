package aivastra.nice.interactive.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.components.GradientButton
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp

@Composable
fun PhotoReviewPage(
    photoUri: String,
    onBack: () -> Unit,
    onRetake: () -> Unit,
    onProceed: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    BackHandler(onBack = onBack)

    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFFF4F2F2))
            .padding(start = sdp(R.dimen._18sdp), end = sdp(R.dimen._18sdp), top = statusBarH + sdp(R.dimen._10sdp), bottom = sdp(R.dimen._34sdp) + navBarH),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(
            modifier = Modifier.fillMaxSize().widthIn(max = sdp(R.dimen._screen_container_width)),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
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

            Spacer(Modifier.height(sdp(R.dimen._8sdp)))
            AsyncImage(
                model = photoUri,
                contentDescription = "Captured customer photo",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
            )
            Spacer(Modifier.height(sdp(R.dimen._16sdp)))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._12sdp))
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .height(sdp(R.dimen._review_action_button_height))
                        .clip(RoundedCornerShape(sdp(R.dimen._8sdp)))
                        .background(Color.White)
                        .border(sdp(R.dimen._1sdp), Color(0xFFD5A14C), RoundedCornerShape(sdp(R.dimen._8sdp)))
                        .clickable(onClick = onRetake),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Image(
                        painter = painterResource(R.drawable.camera_icon_),
                        contentDescription = null,
                        colorFilter = ColorFilter.tint(Color(0xFFC67A05)),
                        modifier = Modifier.size(sdp(R.dimen._17sdp))
                    )
                    Spacer(Modifier.width(sdp(R.dimen._7sdp)))
                    Text(
                        "Retake",
                        color = Color(0xFFC67A05),
                        fontSize = ssp(R.dimen._14ssp),
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = PoppinsFamily
                    )
                }
                GradientButton(
                    onClick = onProceed,
                    width = sdp(R.dimen._0sdp),
                    height = sdp(R.dimen._review_action_button_height),
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(sdp(R.dimen._8sdp))
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.proceed_icon),
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._20sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        Text(
                            text = "Proceed",
                            color = Color.White,
                            fontSize = ssp(R.dimen._14ssp),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = PoppinsFamily
                        )
                    }
                }
            }
            Spacer(Modifier.height(sdp(R.dimen._8sdp)))
        }
    }
}

@Preview(name = "Photo Review - Phone", showBackground = true, widthDp = 375, heightDp = 667)
@Composable
private fun PhotoReviewPagePreview() {
    AiVastraTheme {
        PhotoReviewPage(photoUri = "", onBack = {}, onRetake = {})
    }
}

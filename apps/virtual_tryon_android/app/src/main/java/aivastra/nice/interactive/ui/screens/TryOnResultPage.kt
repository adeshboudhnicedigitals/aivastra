package aivastra.nice.interactive.ui.screens

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.request.SuccessResult
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun TryOnResultPage(
    resultImageUrl: String,
    onBack: () -> Unit,
    onTryAnother: () -> Unit,
    onDownload: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    BackHandler(onBack = onBack)

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Result Image Display
        AsyncImage(
            model = resultImageUrl,
            contentDescription = "Try-On Result",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

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
                            contentDescription = "Try Another",
                            tint = Color(0xFF7E3D00),
                            modifier = Modifier.size(sdp(R.dimen._22sdp))
                        )
                        Spacer(Modifier.width(sdp(R.dimen._8sdp)))
                        Text(
                            text = "Try Another",
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
                        .clickable {
                            downloadResultImage(context, resultImageUrl)
                            onDownload()
                        },
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

private fun downloadResultImage(context: Context, imageUrl: String) {
    val scope = CoroutineScope(Dispatchers.IO)
    scope.launch {
        try {
            val loader = ImageLoader(context)
            val request = ImageRequest.Builder(context)
                .data(imageUrl)
                .allowHardware(false)
                .build()
            val result = (loader.execute(request) as? SuccessResult)?.drawable
            val bitmap = (result as? BitmapDrawable)?.bitmap

            if (bitmap != null) {
                saveBitmapToGallery(context, bitmap)
            } else {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Unable to download image", Toast.LENGTH_SHORT).show()
                }
            }
        } catch (e: Exception) {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Download failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}

private fun saveBitmapToGallery(context: Context, bitmap: Bitmap) {
    val filename = "AiVastra_TryOn_${System.currentTimeMillis()}.jpg"
    val contentValues = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AiVastra")
        }
    }
    val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
    uri?.let {
        context.contentResolver.openOutputStream(it)?.use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
        }
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

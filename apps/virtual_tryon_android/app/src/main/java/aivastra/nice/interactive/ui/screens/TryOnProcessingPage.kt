package aivastra.nice.interactive.ui.screens

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.widget.VideoView
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppDialog
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import aivastra.nice.interactive.AiVastraApplication
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp

/**
 * Custom VideoView subclass that forces layout measurement to occupy 100% of available parent container,
 * ensuring full-bleed edge-to-edge video rendering when paired with VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING.
 */
private class FullScreenVideoView(context: Context) : VideoView(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = getDefaultSize(0, widthMeasureSpec)
        val height = getDefaultSize(0, heightMeasureSpec)
        setMeasuredDimension(width, height)
    }
}

@Composable
fun TryOnProcessingPage(
    elapsedSeconds: Int,
    errorMessage: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit = onBack,
    modifier: Modifier = Modifier
) {
    TryOnProcessingContent(
        elapsedSeconds = elapsedSeconds,
        errorMessage = errorMessage,
        onBack = onBack,
        onRetry = onRetry,
        onCancel = onCancel,
        modifier = modifier
    )
}

@Composable
fun TryOnProcessingContent(
    elapsedSeconds: Int = 0,
    errorMessage: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit = onBack,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val videoUri = remember(context) {
        // Priority 1: Embedded raw video resource (R.raw.loading_video)
        // Fallback: URL / Local Cache via AiVastraApplication
        try {
            Uri.parse("android.resource://${context.packageName}/${R.raw.loading_video}")
        } catch (e: Exception) {
            AiVastraApplication.instance.getCachedVideoUri(context)
        }
    }
    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    BackHandler(onBack = onCancel)

    var hasVideoError by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // ── Layer 1: Full-Screen Background Video Player (Loaded from URL/Cache) ───
        if (!hasVideoError && errorMessage == null) {
            AndroidView(
                factory = { ctx ->
                    FullScreenVideoView(ctx).apply {
                        setVideoURI(videoUri)
                        setOnPreparedListener { mediaPlayer ->
                            mediaPlayer.isLooping = true
                            try {
                                mediaPlayer.setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING)
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                            mediaPlayer.start()
                        }
                        setOnErrorListener { _, what, extra ->
                            Log.e("TryOnProcessingPage", "VideoView error: what=$what, extra=$extra")
                            hasVideoError = true
                            true // Return true to suppress system "Can't play this video" popup
                        }
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Image(
                painter = painterResource(R.drawable.new_app_bg),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }

        // ── Layer 2: Top & Bottom Gradient Scrims for Readability ───────────────
        // Top Gradient Scrim
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(sdp(R.dimen._180sdp))
                .align(Alignment.TopCenter)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color.Black.copy(alpha = 0.85f),
                            Color.Black.copy(alpha = 0.45f),
                            Color.Transparent
                        )
                    )
                )
        )

        // Bottom Gradient Scrim
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(sdp(R.dimen._220sdp))
                .align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.5f),
                            Color.Black.copy(alpha = 0.9f)
                        )
                    )
                )
        )

        // ── Layer 3: Floating UI Content ────────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = sdp(R.dimen._18sdp),
                    end = sdp(R.dimen._18sdp),
                    top = statusBarH + sdp(R.dimen._10sdp),
                    bottom = navBarH + sdp(R.dimen._16sdp)
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Header & Headline Container (Constrained width for tablets)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = sdp(R.dimen._screen_container_width)),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // ── Top Header Bar (Centered Logo without back button) ──────
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    AppHeaderLogo()
                }

                Spacer(Modifier.height(sdp(R.dimen._18sdp)))

                // ── Headline & Subtitle ─────────────────────────────────────
                Text(
                    "Generating Your AI Try-On...",
                    color = Color.White,
                    fontSize = ssp(R.dimen._18ssp),
                    fontWeight = FontWeight.Bold,
                    fontFamily = PoppinsFamily,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(sdp(R.dimen._4sdp)))

                Text(
                    "Please wait while our AI creates your perfect drape",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = ssp(R.dimen._12ssp),
                    fontFamily = PoppinsFamily,
                    textAlign = TextAlign.Center
                )
            }

            // Cancel Button & Error Action Container
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = sdp(R.dimen._screen_container_width)),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Glassmorphic Cancel Generation Button on Video Overlay
                // (hidden once the error dialog is showing to avoid a duplicate cancel action)
                if (errorMessage == null) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(sdp(R.dimen._20sdp)))
                            .background(Color(0x992B1515))
                            .border(
                                width = sdp(R.dimen._1sdp),
                                color = Color(0xFFFF5555).copy(alpha = 0.6f),
                                shape = RoundedCornerShape(sdp(R.dimen._20sdp))
                            )
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onCancel
                            )
                            .padding(horizontal = sdp(R.dimen._18sdp), vertical = sdp(R.dimen._8sdp))
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Cancel",
                                tint = Color(0xFFFF7777),
                                modifier = Modifier.size(sdp(R.dimen._16sdp))
                            )
                            Spacer(Modifier.width(sdp(R.dimen._6sdp)))
                            Text(
                                text = "Cancel Generation",
                                color = Color.White,
                                fontSize = ssp(R.dimen._13ssp),
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = PoppinsFamily
                            )
                        }
                    }
                }
            }
        }

        // ── Error Dialog: shown on any generation / API failure ────────────────
        errorMessage?.let { msg ->
            val isSessionExpired = msg.contains("expired", ignoreCase = true) || msg.contains("not owned", ignoreCase = true)
            val displayText = if (isSessionExpired) {
                "Your photo upload session expired. Please re-upload your photo to continue."
            } else {
                msg
            }
            AppDialog(
                title = "Try-On Failed",
                message = displayText,
                icon = Icons.Default.Warning,
                confirmText = if (isSessionExpired) "Re-upload Photo" else "Retry Try-On",
                cancelText = "Cancel",
                onConfirm = onRetry,
                onDismiss = onCancel
            )
        }
    }
}



package aivastra.nice.interactive.camera

import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.CrashReporter
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas as AndroidCanvas
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.view.View
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.snapshotFlow
import kotlin.math.abs
import androidx.compose.runtime.rememberUpdatedState
import android.hardware.camera2.CaptureRequest
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ExperimentalLensFacing
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import androidx.camera.core.Preview as CameraXPreview

// Fully qualified: this file imports androidx.annotation.OptIn, which can't opt in to Compose markers.
@kotlin.OptIn(ExperimentalFoundationApi::class)
@Composable
fun InternalCameraView(
    onBack: () -> Unit,
    onPhotoCaptured: (Uri) -> Unit,
    // When set, a top-bar button calls this so the host can offer other ways to add a photo
    // (gallery, QR). No button is shown if it's null.
    onMoreOptions: (() -> Unit)? = null,
    // Freezes the pre-capture countdown (e.g. while a host dialog is open) so it can't
    // auto-capture behind it; resumes from the same number when cleared.
    paused: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val isPreview = LocalInspectionMode.current
    val scope = rememberCoroutineScope()
    val statusBarH: Dp = if (isPreview) 28.dp else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    var settings by remember { mutableStateOf(CameraSessionSettings.current) }
    var showSettingsSheet by remember { mutableStateOf(false) }

    LaunchedEffect(settings) {
        CameraSessionSettings.current = settings
    }

    var lensFacing by remember { mutableIntStateOf(CameraSelector.LENS_FACING_BACK) }
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var boundCamera by remember { mutableStateOf<Camera?>(null) }
    var isCapturing by remember { mutableStateOf(false) }
    // True once the shutter has actually been requested (after the focus wait) — tells the
    // "Hold still…" stage apart from "Processing…" and triggers the flash.
    var shutterFired by remember { mutableStateOf(false) }
    var shutterCount by remember { mutableIntStateOf(0) }
    val flashAlpha = remember { Animatable(0f) }
    val captureInteraction = remember { MutableInteractionSource() }
    val isCapturePressed by captureInteraction.collectIsPressedAsState()
    val capturePressScale by animateFloatAsState(
        targetValue = if (isCapturePressed) 0.9f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "capturePressScale"
    )

    // Expanding ring around the capture button, repeated for as long as a capture is running.
    val ringProgress = remember { Animatable(0f) }
    LaunchedEffect(isCapturing) {
        if (isCapturing) {
            while (true) {
                ringProgress.snapTo(0f)
                ringProgress.animateTo(1f, tween(durationMillis = 900))
            }
        } else {
            ringProgress.snapTo(0f)
        }
    }

    // Brief white flash the moment the shutter fires — instant feedback that the tap registered.
    LaunchedEffect(shutterCount) {
        if (shutterCount > 0) {
            flashAlpha.snapTo(0.85f)
            flashAlpha.animateTo(0f, tween(durationMillis = 140))
        }
    }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }

    var filter by remember { mutableStateOf(CameraFilterOption.ORIGINAL) }
    // The countdown effect holds the triggerCapture lambda from whenever it was launched, so the
    // capture must read the filter through this rather than closing over a stale value.
    val currentFilter = rememberUpdatedState(filter)
    // Per-filter manual adjustments (Original included), opened by long-pressing a filter. They are
    // persisted on disk by FilterAdjustmentStore, so each filter keeps its tuning across app
    // restarts until the customer taps Reset. Saved in the change callback, not an effect, so a
    // filter switch can never write one filter's values under another's name.
    var adjustments by remember {
        // The store must know the app context before its first read.
        FilterAdjustmentStore.initialize(context)
        mutableStateOf(FilterAdjustmentStore.load(CameraFilterOption.ORIGINAL))
    }
    val currentAdjustments = rememberUpdatedState(adjustments)
    var showAdjustBar by remember { mutableStateOf(false) }
    LaunchedEffect(filter) {
        adjustments = FilterAdjustmentStore.load(filter)
    }

    var countdown by remember { mutableIntStateOf(settings.countdownSeconds) }
    var availablePictureSizes by remember { mutableStateOf<List<Size>>(emptyList()) }
    var showTimerOptions by remember { mutableStateOf(false) }
    // Only auto-pick the highest resolution once per screen visit, so a user's later, explicit
    // "Auto" choice isn't silently overridden the next time the lens (front/back) is switched.
    var hasAppliedDefaultPictureSize by remember { mutableStateOf(false) }

    val previewView = remember {
        PreviewView(context).apply {
            // FILL_CENTER keeps framing consistent (no stretch/letterbox) across the very
            // different screen sizes phones vs. kiosk panels present.
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }

    LaunchedEffect(Unit) {
        if (!isPreview) {
            reportCameraDiagnostic(context, "camera_screen_opened")
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                try {
                    cameraProvider = future.get()
                    reportCameraDiagnostic(
                        context,
                        "camera_provider_obtained",
                        mapOf("cameras" to describeAvailableCameras(context))
                    )
                } catch (e: Exception) {
                    Log.e("InternalCameraView", "Failed to obtain ProcessCameraProvider", e)
                    reportCameraDiagnostic(context, "camera_provider_obtain_failed")
                }
            }, ContextCompat.getMainExecutor(context))
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            try {
                cameraProvider?.unbindAll()
            } catch (e: Exception) {
                Log.e("InternalCameraView", "Failed to unbind camera on dispose", e)
            }
        }
    }

    LaunchedEffect(settings.cameraFacing) {
        lensFacing = when (settings.cameraFacing) {
            CameraFacingOption.BACK -> CameraSelector.LENS_FACING_BACK
            CameraFacingOption.FRONT -> CameraSelector.LENS_FACING_FRONT
        }
    }

    LaunchedEffect(lensFacing) {
        if (isPreview) return@LaunchedEffect
        val sizes = withContext(Dispatchers.IO) { queryOutputPictureSizes(context, lensFacing) }
        availablePictureSizes = sizes
        // A resolution picked on the other lens may not exist on this one — fall back to auto
        // rather than silently applying a mismatched fallback size.
        if (settings.pictureSize != null && settings.pictureSize !in sizes) {
            settings = settings.copy(pictureSize = null)
        }
        // Default "Picture Resolution" to the largest size this camera reports that stays within
        // DEFAULT_MAX_PICTURE_PIXELS (or the smallest one if every size is bigger), instead of the
        // absolute maximum — which is slow to capture and encode and more than try-on needs.
        if (!hasAppliedDefaultPictureSize && settings.pictureSize == null && sizes.isNotEmpty()) {
            val pixels = { size: Size -> size.width.toLong() * size.height.toLong() }
            val underCap = sizes.filter { pixels(it) <= DEFAULT_MAX_PICTURE_PIXELS }
            // The app crops every photo to 9:16 portrait, so a 16:9 sensor size keeps all its
            // pixels while a 4:3 one of the same area loses a third of them.
            val isWide = { size: Size ->
                val ratio = maxOf(size.width, size.height).toFloat() / minOf(size.width, size.height)
                kotlin.math.abs(ratio - 16f / 9f) < 0.05f
            }
            val preferred = underCap.filter(isWide).maxByOrNull(pixels)
                ?: underCap.maxByOrNull(pixels)
                ?: sizes.minByOrNull(pixels)
            if (preferred != null) {
                settings = settings.copy(pictureSize = preferred)
            }
        }
        // Flipped even when no size was picked: the bind effect below waits for this, so the
        // camera is bound once with the final size instead of bound, then torn down and rebound.
        hasAppliedDefaultPictureSize = true
    }

    // Live preview of the chosen look. A hardware layer paint tints the PreviewView's TextureView
    // (the default stream type); a SurfaceView preview can't be filtered this way, but the
    // captured photo is filtered either way.
    LaunchedEffect(filter, adjustments) {
        if (filter.isOriginal && adjustments.isNeutral) {
            previewView.setLayerType(View.LAYER_TYPE_NONE, null)
        } else {
            val paint = Paint().apply {
                colorFilter = ColorMatrixColorFilter(colorMatrixFor(filter, adjustments))
            }
            previewView.setLayerType(View.LAYER_TYPE_HARDWARE, paint)
        }
    }

    LaunchedEffect(
        cameraProvider,
        lensFacing,
        settings.hdrOption,
        settings.captureQuality,
        settings.resolutionRatio,
        settings.surfaceStreamType,
        settings.pictureSize,
        hasAppliedDefaultPictureSize
    ) {
        if (isPreview) return@LaunchedEffect
        val provider = cameraProvider ?: return@LaunchedEffect
        // Wait for the default picture size to be chosen — see the sizes effect above.
        if (!hasAppliedDefaultPictureSize) return@LaunchedEffect

        previewView.implementationMode = when (settings.surfaceStreamType) {
            SurfaceStreamTypeOption.SURFACE_VIEW -> PreviewView.ImplementationMode.PERFORMANCE
            SurfaceStreamTypeOption.TEXTURE_VIEW -> PreviewView.ImplementationMode.COMPATIBLE
        }

        val resolutionSelector = settings.toResolutionSelector()

        val preview = CameraXPreview.Builder()
            .setResolutionSelector(resolutionSelector)
            .build()
            .also { it.surfaceProvider = previewView.surfaceProvider }

        val jpegQuality = if (settings.pictureSize != null) {
            CAPTURE_JPEG_QUALITY
        } else {
            minOf(CAPTURE_JPEG_QUALITY, settings.captureQuality.toJpegQuality())
        }
        // MAXIMIZE_QUALITY runs a full AF/AE precapture sequence inside takePicture (measured ~0.6s
        // on a phone) on top of the focus lock capturePhoto already does, so phones take the
        // latency mode. USB/kiosk cameras keep it: that is what fixed their blurry captures.
        val captureMode = if (hasUsbCamera(context) || isKioskDevice(context)) {
            ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY
        } else {
            ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY
        }
        val captureBuilder = ImageCapture.Builder()
            .setCaptureMode(captureMode)
            .setJpegQuality(jpegQuality)
            .setResolutionSelector(resolutionSelector)
            // Kiosk boxes are often fixed-mount with no accelerometer, so CameraX's own
            // rotation defaults can't be trusted — tell it the real display rotation explicitly.
            .setTargetRotation(currentSurfaceRotation(context))
        applyKioskCaptureTuning(context, captureBuilder)
        val capture = captureBuilder.build()
        imageCapture = capture

        var cameraSelector = resolveCameraSelector(provider, lensFacing)

        if (settings.hdrOption != HdrOption.HDR_OFF) {
            cameraSelector = resolveHdrCameraSelector(
                context = context,
                provider = provider,
                baseSelector = cameraSelector,
                forceHdr = settings.hdrOption == HdrOption.HDR_ON
            )
        }

        try {
            provider.unbindAll()
            val camera = provider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                capture
            )
            boundCamera = camera
            applyDefaultExposure(camera)
            reportCameraDiagnostic(
                context,
                "camera_bind_success",
                mapOf(
                    "implementation_mode" to settings.surfaceStreamType.name,
                    "hdr_option" to settings.hdrOption.name
                )
            )
        } catch (e: Exception) {
            Log.e("InternalCameraView", "Tuned camera binding failed, retrying with defaults", e)
            reportCameraDiagnostic(
                context,
                "camera_bind_failed_retrying_defaults",
                mapOf("error" to "${e::class.java.simpleName}: ${e.message}")
            )
            try {
                val fallbackCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .build()
                imageCapture = fallbackCapture
                provider.unbindAll()
                val camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    resolveCameraSelector(provider, lensFacing),
                    CameraXPreview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider },
                    fallbackCapture
                )
                boundCamera = camera
                applyDefaultExposure(camera)
                reportCameraDiagnostic(context, "camera_bind_fallback_success")
            } catch (fallbackError: Exception) {
                Log.e("InternalCameraView", "Fallback camera binding failed", fallbackError)
                reportCameraDiagnostic(
                    context,
                    "camera_bind_fallback_failed",
                    mapOf("error" to "${fallbackError::class.java.simpleName}: ${fallbackError.message}")
                )
            }
        }
    }

    // Shared by the timer and the capture button so both get the same feedback stages.
    val triggerCapture: () -> Unit = {
        capturePhoto(
            context = context,
            scope = scope,
            camera = boundCamera,
            previewView = previewView,
            imageCapture = imageCapture,
            isFrontCamera = (lensFacing == CameraSelector.LENS_FACING_FRONT),
            filter = currentFilter.value,
            adjustments = currentAdjustments.value,
            onStart = {
                showAdjustBar = false
                isCapturing = true
                shutterFired = false
            },
            onShutter = {
                shutterFired = true
                shutterCount++
            },
            onCaptured = { uri ->
                isCapturing = false
                shutterFired = false
                onPhotoCaptured(uri)
            },
            onError = {
                isCapturing = false
                shutterFired = false
            }
        )
    }

    // The countdown also holds while the adjust panel is open, so it can't fire the shutter
    // while the customer is still tuning the look.
    LaunchedEffect(countdown, paused, showAdjustBar) {
        if (countdown > 0 && !paused && !showAdjustBar && !isPreview) {
            delay(1000)
            if (countdown == 1) {
                countdown = 0
                triggerCapture()
            } else {
                countdown -= 1
            }
        }
    }

    Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
        if (isPreview) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xFF1B120B)),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(R.drawable.take_photo_icon),
                    contentDescription = "Camera Preview Placeholder",
                    modifier = Modifier.size(sdp(R.dimen._120sdp))
                )
            }
        } else {
            AndroidView(
                factory = { previewView },
                modifier = Modifier.fillMaxSize()
            )
            // Vignette can't go through the preview's colour-filter layer, so it's drawn over it;
            // the saved photo draws the same gradient (applyVignette).
            if (adjustments.hasVignette) {
                val edge = Color(vignetteColorArgb(adjustments.vignette))
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .drawBehind {
                            drawRect(
                                Brush.radialGradient(
                                    colorStops = arrayOf(
                                        0f to edge.copy(alpha = 0f),
                                        VIGNETTE_INNER_STOP to edge.copy(alpha = 0f),
                                        1f to edge
                                    ),
                                    center = center,
                                    radius = kotlin.math.hypot(size.width, size.height) / 2f
                                )
                            )
                        }
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = sdp(R.dimen._18sdp),
                    end = sdp(R.dimen._18sdp),
                    top = statusBarH + sdp(R.dimen._10sdp),
                    bottom = sdp(R.dimen._22sdp) + navBarH
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top Header Bar
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._10sdp)),
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
                            modifier = Modifier.size(sdp(R.dimen._14sdp))
                        )
                    }
                }

                AppHeaderLogo()
            }

            // Banner Message & Countdown
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = "Smile Your Virtual TryOn Begins Now",
                    color = Color.White,
                    fontSize = ssp(R.dimen._15ssp),
                    fontWeight = FontWeight.Medium,
                    fontFamily = PoppinsFamily
                )

                Spacer(Modifier.height(sdp(R.dimen._18sdp)))

                if (countdown > 0) {
                    Text(
                        text = countdown.toString(),
                        color = Color.White,
                        fontSize = ssp(R.dimen._55ssp),
                        fontWeight = FontWeight.Bold,
                        fontFamily = PoppinsFamily
                    )
                }

                if (isCapturing) {
                    Text(
                        text = if (shutterFired) "Processing photo…" else "Hold still…",
                        color = Color.White,
                        fontSize = ssp(R.dimen._14ssp),
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = PoppinsFamily,
                        modifier = Modifier
                            .clip(RoundedCornerShape(sdp(R.dimen._40sdp)))
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = sdp(R.dimen._16sdp), vertical = sdp(R.dimen._8sdp))
                    )
                }
            }

            // Bottom Control Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = sdp(R.dimen._20sdp)),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._12sdp)),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Timer: tap to pick a countdown duration; the selection stops/starts the
                    // pre-capture countdown immediately (Off cancels it, a duration restarts it).
                    Box {
                        Box(
                            modifier = Modifier
                                .size(sdp(R.dimen._camera_control_button_size))
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.5f))
                                .clickable { showTimerOptions = true },
                            contentAlignment = Alignment.Center
                        ) {
                            TimerIcon(
                                tint = Color.White,
                                modifier = Modifier.size(sdp(R.dimen._camera_control_timer_icon_size))
                            )
                            if (settings.timerOption != TimerOption.OFF) {
                                Text(
                                    text = "${settings.timerOption.seconds}",
                                    color = Color.White,
                                    fontSize = ssp(R.dimen._9ssp),
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = PoppinsFamily,
                                    modifier = Modifier
                                        .align(Alignment.BottomEnd)
                                        .padding(bottom = sdp(R.dimen._3sdp), end = sdp(R.dimen._4sdp))
                                )
                            }
                        }

                        DropdownMenu(
                            expanded = showTimerOptions,
                            onDismissRequest = { showTimerOptions = false },
                            containerColor = Color(0xFF1B1E24)
                        ) {
                            TimerOption.values().forEach { option ->
                                val isSelected = settings.timerOption == option
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = option.label,
                                            color = if (isSelected) Color(0xFFE59B27) else Color.White,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                            fontFamily = PoppinsFamily,
                                            fontSize = ssp(R.dimen._14ssp)
                                        )
                                    },
                                    onClick = {
                                        settings = settings.copy(
                                            timerOption = option,
                                            countdownSeconds = option.seconds
                                        )
                                        // Apply immediately: cancels an in-progress countdown when
                                        // Off is picked, or restarts it at the new duration.
                                        countdown = option.seconds
                                        showTimerOptions = false
                                    }
                                )
                            }
                        }
                    }

                    Box(
                        modifier = Modifier
                            .size(sdp(R.dimen._camera_control_button_size))
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.5f))
                            .clickable { showSettingsSheet = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Camera & Texture Settings",
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._camera_control_icon_size))
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .size(sdp(R.dimen._72sdp))
                        .graphicsLayer {
                            scaleX = capturePressScale
                            scaleY = capturePressScale
                        }
                        // Placed before clip() on purpose so the ring can grow past the button's edge.
                        .drawBehind {
                            val p = ringProgress.value
                            if (p > 0f) {
                                drawCircle(
                                    color = Color(0xFFE7A52C).copy(alpha = (1f - p) * 0.7f),
                                    radius = size.minDimension / 2f * (1f + 0.7f * p),
                                    style = Stroke(width = 3.dp.toPx())
                                )
                            }
                        }
                        .clip(CircleShape)
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                            )
                        )
                        .border(sdp(R.dimen._3sdp), Color.White, CircleShape)
                        .clickable(
                            interactionSource = captureInteraction,
                            indication = LocalIndication.current,
                            enabled = !isCapturing
                        ) {
                            countdown = 0
                            triggerCapture()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    if (isCapturing) {
                        // The camera icon itself stays and "breathes" while a thin arc spins
                        // around it, instead of being swapped for a plain spinner.
                        val pulse by rememberInfiniteTransition(label = "captureIconPulse").animateFloat(
                            initialValue = 0.85f,
                            targetValue = 1.1f,
                            animationSpec = infiniteRepeatable(tween(450), RepeatMode.Reverse),
                            label = "captureIconPulseScale"
                        )
                        CircularProgressIndicator(
                            color = Color.White,
                            strokeWidth = sdp(R.dimen._2sdp),
                            modifier = Modifier.size(sdp(R.dimen._50sdp))
                        )
                        Image(
                            painter = painterResource(R.drawable.camera_icon_),
                            contentDescription = "Capturing",
                            colorFilter = ColorFilter.tint(Color.White),
                            modifier = Modifier
                                .size(sdp(R.dimen._26sdp))
                                .graphicsLayer {
                                    scaleX = pulse
                                    scaleY = pulse
                                }
                        )
                    } else {
                        Image(
                            painter = painterResource(R.drawable.camera_icon_),
                            contentDescription = "Capture Photo",
                            colorFilter = ColorFilter.tint(Color.White),
                            modifier = Modifier.size(sdp(R.dimen._30sdp))
                        )
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._12sdp)),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(sdp(R.dimen._camera_control_button_size))
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.5f))
                            .clickable {
                                lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) {
                                    CameraSelector.LENS_FACING_FRONT
                                } else {
                                    CameraSelector.LENS_FACING_BACK
                                }
                                settings = settings.copy(
                                    cameraFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK)
                                        CameraFacingOption.BACK else CameraFacingOption.FRONT
                                )
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Switch Camera",
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._camera_control_icon_size))
                        )
                    }

                    // Gallery / QR alternatives, kept beside the flip button so the top bar stays clean.
                    if (onMoreOptions != null) {
                        Box(
                            modifier = Modifier
                                .size(sdp(R.dimen._camera_control_button_size))
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.5f))
                                .clickable(onClick = onMoreOptions),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_photo_gallery),
                                contentDescription = "Use gallery or QR instead",
                                tint = Color.White,
                                modifier = Modifier.size(sdp(R.dimen._camera_control_icon_size))
                            )
                        }
                    }
                }
            }
        }

        // Filter picker, floating just above the bottom control bar (button 72 + its 20 bottom
        // padding + 22 screen padding + nav bar), so the existing SpaceBetween layout is untouched.
        //
        // It's a centered snap carousel: whichever filter settles nearest the middle is the
        // selected one, so the customer just swipes — no tap needed (a tap still scrolls to it).
        BoxWithConstraints(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(
                    bottom = navBarH + sdp(R.dimen._22sdp) + sdp(R.dimen._20sdp) + sdp(R.dimen._72sdp) + sdp(R.dimen._20sdp)
                )
        ) {
            val filterOptions = remember { CameraFilterOption.values() }
            // Fixed item width: the snap position and the side padding below only line up on the
            // exact centre if every chip is the same width.
            val itemWidth = sdp(R.dimen._72sdp)
            val edgePadding = (maxWidth - itemWidth) / 2
            val filterListState = rememberLazyListState()

            val centeredIndex by remember {
                derivedStateOf {
                    val info = filterListState.layoutInfo
                    val viewportCenter = (info.viewportStartOffset + info.viewportEndOffset) / 2
                    info.visibleItemsInfo
                        .minByOrNull { abs(it.offset + it.size / 2 - viewportCenter) }
                        ?.index
                }
            }
            LaunchedEffect(filterListState) {
                snapshotFlow { centeredIndex }.collect { index ->
                    if (index != null) filter = filterOptions[index]
                }
            }

            LazyRow(
                state = filterListState,
                flingBehavior = rememberSnapFlingBehavior(filterListState),
                contentPadding = PaddingValues(horizontal = edgePadding),
                horizontalArrangement = Arrangement.spacedBy(sdp(R.dimen._12sdp)),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                itemsIndexed(filterOptions) { index, option ->
                    val selected = filter == option
                    val tileScale by animateFloatAsState(
                        targetValue = if (selected) 1.28f else 0.92f,
                        label = "filterTileScale"
                    )
                    // Non-centred filters fade back so the one under the shutter stands out
                    // while scrolling.
                    val tileAlpha by animateFloatAsState(
                        targetValue = if (selected) 1f else 0.55f,
                        label = "filterTileAlpha"
                    )
                    // Icon sits in its own round tile and the name is printed below it, so the
                    // two never crowd each other the way a single boxed chip did.
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .graphicsLayer { alpha = tileAlpha }
                            .width(itemWidth)
                            .clip(RoundedCornerShape(sdp(R.dimen._10sdp)))
                            .combinedClickable(
                                onClick = { scope.launch { filterListState.animateScrollToItem(index) } },
                                // Long press: centre this filter and open its adjust panel
                                // (every filter, Original included).
                                onLongClick = {
                                    scope.launch { filterListState.animateScrollToItem(index) }
                                    showAdjustBar = true
                                }
                            )
                            // Top room for the selected icon's scale-up (50sdp * 0.28 / 2 per side
                            // = 7sdp, plus the border) — the clip above would otherwise cut it off.
                            .padding(top = sdp(R.dimen._12sdp), bottom = sdp(R.dimen._4sdp))
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(sdp(R.dimen._50sdp))
                                .graphicsLayer {
                                    scaleX = tileScale
                                    scaleY = tileScale
                                }
                                .clip(CircleShape)
                                // Same grey fill selected or not — only the stroke carries the
                                // primary colour, so the selected filter reads without a filled blob.
                                .background(Color.Black.copy(alpha = 0.5f))
                                .border(
                                    width = if (selected) sdp(R.dimen._2sdp) else 1.dp,
                                    color = if (selected) Color(0xFFE59B27) else Color.White.copy(alpha = 0.35f),
                                    shape = CircleShape
                                )
                        ) {
                            CameraFilterIcon(
                                option = option,
                                tint = Color.White,
                                modifier = Modifier.size(sdp(R.dimen._24sdp))
                            )
                        }
                        Spacer(Modifier.height(sdp(R.dimen._8sdp)))
                        Text(
                            text = option.label,
                            color = if (selected) Color.White else Color.White.copy(alpha = 0.85f),
                            fontSize = ssp(R.dimen._12ssp),
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            fontFamily = PoppinsFamily,
                            maxLines = 1,
                            // Labels now sit straight on the camera feed, so keep them legible.
                            style = TextStyle(shadow = Shadow(Color.Black.copy(alpha = 0.8f), blurRadius = 6f))
                        )
                    }
                }
            }
        }

        // Adjust panel for the centred filter, opened by long-pressing a filter. Capped at roughly
        // half the screen so the live preview stays visible while sliding.
        AnimatedVisibility(
            visible = showAdjustBar,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomStart)
        ) {
            BoxWithConstraints {
                FilterAdjustPanel(
                    filter = filter,
                    adjustments = adjustments,
                    onChange = {
                        adjustments = it
                        FilterAdjustmentStore.save(filter, it)
                    },
                    onReset = {
                        val fresh = FilterAdjustments()
                        adjustments = fresh
                        FilterAdjustmentStore.save(filter, fresh)
                    },
                    onDone = { showAdjustBar = false },
                    modifier = Modifier
                        // Left half only, so the right side of the live preview stays unobstructed.
                        .fillMaxWidth(0.5f)
                        .heightIn(max = maxHeight * 0.55f)
                        .padding(bottom = navBarH)
                )
            }
        }

        // Shutter flash. The alpha is read inside graphicsLayer, so animating it only redraws
        // this layer instead of recomposing the whole camera screen.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = flashAlpha.value }
                .background(Color.White)
        )

        AnimatedVisibility(
            visible = showSettingsSheet,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            CameraSettingsDialog(
                initialSettings = settings,
                availablePictureSizes = availablePictureSizes,
                onDismiss = { showSettingsSheet = false },
                onSaveSettings = { updated ->
                    settings = updated
                    countdown = updated.countdownSeconds
                    showSettingsSheet = false
                }
            )
        }

    }
}

@Composable
private fun TimerIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val strokeWidth = size.minDimension * 0.1f
        val radius = size.minDimension / 2f - strokeWidth
        drawCircle(color = tint, radius = radius, style = Stroke(width = strokeWidth))
        drawLine(
            color = tint,
            start = center,
            end = Offset(center.x, center.y - radius * 0.55f),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round
        )
        drawLine(
            color = tint,
            start = center,
            end = Offset(center.x + radius * 0.4f, center.y),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round
        )
    }
}

private fun capturePhoto(
    context: Context,
    scope: CoroutineScope,
    camera: Camera?,
    previewView: PreviewView,
    imageCapture: ImageCapture?,
    isFrontCamera: Boolean,
    filter: CameraFilterOption,
    adjustments: FilterAdjustments,
    onStart: () -> Unit,
    onShutter: () -> Unit,
    onCaptured: (Uri) -> Unit,
    onError: () -> Unit
) {
    val capture = imageCapture ?: run {
        onError()
        return
    }
    onStart()

    scope.launch {
        try {
            // Kiosk/fixed-mount cameras often sit with AF/AE not yet converged between shots;
            // re-locking on the frame center right before the shutter is what actually fixes
            // the "blurry, washed out" kiosk captures (mirrors what the legacy CameraX activity did).
            val t0 = android.os.SystemClock.elapsedRealtime()
            lockFocusAndExposure(camera, previewView)
            val tFocus = android.os.SystemClock.elapsedRealtime()
            capture.targetRotation = currentSurfaceRotation(context)
            onShutter()

            val file = File(context.cacheDir, "camera_capture_${System.currentTimeMillis()}.jpg")
            val outputOptions = ImageCapture.OutputFileOptions.Builder(file).build()

            val savedUri = suspendCancellableCoroutine<Uri> { cont ->
                capture.takePicture(
                    outputOptions,
                    ContextCompat.getMainExecutor(context),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                            cont.resume(outputFileResults.savedUri ?: Uri.fromFile(file))
                        }

                        override fun onError(exception: ImageCaptureException) {
                            cont.resumeWithException(exception)
                        }
                    }
                )
            }

            val tSaved = android.os.SystemClock.elapsedRealtime()

            val fixedUri = fixImageRotationFromUri(
                context = context,
                imageUri = savedUri,
                cameraResultRotation = currentSurfaceRotation(context),
                isFrontCamera = isFrontCamera,
                filter = filter,
                adjustments = adjustments
            )

            Log.i(
                "InternalCameraView",
                "capture timing: focus=${tFocus - t0}ms takePicture=${tSaved - tFocus}ms " +
                    "postProcess=${android.os.SystemClock.elapsedRealtime() - tSaved}ms"
            )
            onCaptured(fixedUri)
        } catch (e: Exception) {
            Log.e("InternalCameraView", "Photo capture failed", e)
            onError()
        }
    }
}

private fun applyDefaultExposure(camera: Camera) {
    try {
        val exposureState = camera.cameraInfo.exposureState
        if (!exposureState.isExposureCompensationSupported) return
        val range = exposureState.exposureCompensationRange
        if (range.lower <= 0 && range.upper >= 0) {
            camera.cameraControl.setExposureCompensationIndex(0)
        }
    } catch (e: Exception) {
        Log.e("InternalCameraView", "Failed to reset exposure", e)
    }
}

private const val FOCUS_LOCK_TIMEOUT_MS = 400L
private const val FOCUS_LOCK_MAX_TIMEOUTS = 2

// Consecutive focus-lock timeouts per lens facing; reset by any lock that converges.
private val focusLockTimeouts = mutableMapOf<Int, Int>()

// Default capture size cap (pixels) — about 1080x1920, which is what the try-on consumes. The
// kiosk mini PC's SoC spent seconds encoding/decoding 8MP frames only to crop them to 9:16; a
// customer can still pick a larger size in the camera settings.
private const val DEFAULT_MAX_PICTURE_PIXELS = 2_200_000L

// Quality used for every JPEG this screen writes. Visually indistinguishable from 100 but encodes
// faster and produces a much smaller file to process and upload.
private const val CAPTURE_JPEG_QUALITY = 92

private suspend fun lockFocusAndExposure(camera: Camera?, previewView: PreviewView) {
    val cam = camera ?: return
    if (previewView.width == 0 || previewView.height == 0) return
    try {
        val factory = previewView.meteringPointFactory
        val point = factory.createPoint(previewView.width / 2f, previewView.height / 2f)
        val action = FocusMeteringAction.Builder(
            point,
            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE or FocusMeteringAction.FLAG_AWB
        ).setAutoCancelDuration(5, TimeUnit.SECONDS).build()

        // Most USB/UVC cameras have no AF/AE metering control, so the request can never converge
        // and would just burn the whole timeout below before every shot.
        if (!cam.cameraInfo.isFocusMeteringSupported(action)) return

        // A camera that timed out twice in a row (measured: a phone's front camera burned the full
        // 700ms before every shot) will not converge now either, so stop paying that wait.
        val lens = cam.cameraInfo.lensFacing
        if ((focusLockTimeouts[lens] ?: 0) >= FOCUS_LOCK_MAX_TIMEOUTS) return

        // Bounded: a slow-to-converge kiosk camera can otherwise hold the shot for seconds. On
        // timeout the shot goes ahead with whatever focus the camera has reached by then.
        val converged = withTimeoutOrNull(FOCUS_LOCK_TIMEOUT_MS) {
            suspendCancellableCoroutine<Unit> { cont ->
                val future = cam.cameraControl.startFocusAndMetering(action)
                future.addListener(
                    { if (cont.isActive) cont.resume(Unit) },
                    ContextCompat.getMainExecutor(previewView.context)
                )
            }
            true
        }
        focusLockTimeouts[lens] = if (converged == true) 0 else (focusLockTimeouts[lens] ?: 0) + 1
    } catch (e: Exception) {
        Log.e("InternalCameraView", "Focus/exposure lock failed", e)
    }
}

@OptIn(ExperimentalCamera2Interop::class)
private fun applyKioskCaptureTuning(context: Context, builder: ImageCapture.Builder) {
    // Generic kiosk/USB camera HALs default to fast, low-quality JPEG encode and noise
    // reduction to save CPU. Forcing these Camera2 request keys to HIGH_QUALITY is what
    // actually raises captured quality on those boxes; phones already default to this.
    if (!hasUsbCamera(context) && !isKioskDevice(context)) return
    try {
        val extender = Camera2Interop.Extender(builder)
        extender.setCaptureRequestOption(CaptureRequest.JPEG_QUALITY, CAPTURE_JPEG_QUALITY.toByte())
        extender.setCaptureRequestOption(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_HIGH_QUALITY)
        extender.setCaptureRequestOption(
            CaptureRequest.NOISE_REDUCTION_MODE,
            CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY
        )
        extender.setCaptureRequestOption(
            CaptureRequest.COLOR_CORRECTION_ABERRATION_MODE,
            CaptureRequest.COLOR_CORRECTION_ABERRATION_MODE_HIGH_QUALITY
        )
        extender.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
        extender.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
    } catch (e: Exception) {
        Log.e("InternalCameraView", "Camera2Interop tuning unsupported on this device", e)
    }
}

// Vendor Camera2 Extensions HAL implementations are not guaranteed to complete this future.
// A bound-but-broken HAL on some boxes has been observed to never resolve it, which would
// otherwise stall camera binding indefinitely — bounding it here keeps that failure mode from
// blocking the preview forever. Real extension resolution normally completes in well under a
// second, so this timeout never fires on a healthy device.
private const val EXTENSIONS_MANAGER_TIMEOUT_MS = 5000L

private suspend fun resolveHdrCameraSelector(
    context: Context,
    provider: ProcessCameraProvider,
    baseSelector: CameraSelector,
    forceHdr: Boolean
): CameraSelector {
    val extensionsManager = withTimeoutOrNull(EXTENSIONS_MANAGER_TIMEOUT_MS) {
        awaitExtensionsManager(context, provider)
    }
    if (extensionsManager == null) {
        reportCameraDiagnostic(context, "hdr_extensions_manager_unavailable_or_timed_out")
        return baseSelector
    }
    return try {
        when {
            extensionsManager.isExtensionAvailable(baseSelector, ExtensionMode.HDR) -> {
                reportCameraDiagnostic(context, "hdr_extension_hdr_mode_enabled")
                extensionsManager.getExtensionEnabledCameraSelector(baseSelector, ExtensionMode.HDR)
            }
            !forceHdr && extensionsManager.isExtensionAvailable(baseSelector, ExtensionMode.AUTO) -> {
                reportCameraDiagnostic(context, "hdr_extension_auto_mode_enabled")
                extensionsManager.getExtensionEnabledCameraSelector(baseSelector, ExtensionMode.AUTO)
            }
            else -> {
                reportCameraDiagnostic(context, "hdr_extension_not_available")
                baseSelector
            }
        }
    } catch (e: Exception) {
        Log.e("InternalCameraView", "HDR extension selection failed", e)
        reportCameraDiagnostic(context, "hdr_extension_selection_exception")
        baseSelector
    }
}

private suspend fun awaitExtensionsManager(
    context: Context,
    provider: ProcessCameraProvider
): ExtensionsManager? = suspendCancellableCoroutine { cont ->
    val future = ExtensionsManager.getInstanceAsync(context, provider)
    future.addListener(
        {
            try {
                cont.resume(future.get())
            } catch (e: Exception) {
                Log.e("InternalCameraView", "Failed to obtain ExtensionsManager", e)
                cont.resume(null)
            }
        },
        ContextCompat.getMainExecutor(context)
    )
}

// Non-fatal breadcrumbs for diagnosing device-specific blank-preview/hang reports that have no
// repro on hand and no adb access — shows up in Firebase Crashlytics grouped under
// "CameraDiagnosticEvent" with the device's Build.* properties attached as custom keys, so a
// specific box's behavior can be read off the dashboard instead of guessed at from code.
private fun reportCameraDiagnostic(context: Context, event: String, extra: Map<String, String> = emptyMap()) {
    try {
        CrashReporter.setCustomKey("camera_diag_manufacturer", Build.MANUFACTURER)
        CrashReporter.setCustomKey("camera_diag_model", Build.MODEL)
        CrashReporter.setCustomKey("camera_diag_device", Build.DEVICE)
        CrashReporter.setCustomKey("camera_diag_product", Build.PRODUCT)
        CrashReporter.setCustomKey("camera_diag_sdk_int", Build.VERSION.SDK_INT.toString())
        CrashReporter.setCustomKey("camera_diag_is_kiosk_device", isKioskDevice(context).toString())
        CrashReporter.setCustomKey("camera_diag_has_usb_camera", hasUsbCamera(context).toString())
        extra.forEach { (key, value) -> CrashReporter.setCustomKey("camera_diag_$key", value) }
        CrashReporter.recordException(CameraDiagnosticEvent(event), "CameraDiagnostics")
    } catch (e: Exception) {
        Log.e("InternalCameraView", "Failed to report camera diagnostic", e)
    }
}

private class CameraDiagnosticEvent(message: String) : Exception(message)

fun isKioskDevice(context: Context): Boolean {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val isLockTask = am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_LOCKED

    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val isDeviceOwner = dpm.isDeviceOwnerApp(context.packageName)

    val isTv = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

    val manufacturer = Build.MANUFACTURER.lowercase()
    val model = Build.MODEL.lowercase()
    val device = Build.DEVICE.lowercase()
    val product = Build.PRODUCT.lowercase()

    val isCustomKiosk =
        manufacturer.contains("rockchip") ||
        manufacturer.contains("amlogic") ||
        manufacturer.contains("allwinner") ||
        model.contains("rk") ||
        model.contains("box") ||
        model.contains("tv") ||
        device.contains("box") ||
        device.contains("tv") ||
        device.contains("kiosk") ||
        product.contains("box") ||
        product.contains("tv")

    return isLockTask || isDeviceOwner || isTv || isCustomKiosk
}

// Kiosk boxes with a USB/UVC camera report LENS_FACING_EXTERNAL, so requireLensFacing(BACK/FRONT)
// alone matches nothing and the preview stays black. Prefer the requested lens, then an external
// camera, then whatever camera exists.
@OptIn(ExperimentalLensFacing::class)
private fun resolveCameraSelector(provider: ProcessCameraProvider, lensFacing: Int): CameraSelector {
    val candidates = listOf(
        CameraSelector.Builder().requireLensFacing(lensFacing).build(),
        CameraSelector.Builder().requireLensFacing(CameraSelector.LENS_FACING_EXTERNAL).build(),
        CameraSelector.Builder().build()
    )
    return candidates.firstOrNull { selector ->
        try {
            provider.hasCamera(selector)
        } catch (e: Exception) {
            false
        }
    } ?: candidates.first()
}

// Confirms or rules out the "CameraSelector.requireLensFacing(BACK) matches nothing" theory —
// a USB/UVC kiosk camera module commonly reports LENS_FACING_EXTERNAL, not BACK or FRONT, which
// would make every bind attempt in this file fail with no camera found for the selector.
private fun describeAvailableCameras(context: Context): String {
    return try {
        val cameraManager =
            context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
        cameraManager.cameraIdList.joinToString(prefix = "[", postfix = "]") { cameraId ->
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val facing = when (characteristics.get(android.hardware.camera2.CameraCharacteristics.LENS_FACING)) {
                android.hardware.camera2.CameraCharacteristics.LENS_FACING_BACK -> "BACK"
                android.hardware.camera2.CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
                android.hardware.camera2.CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
                null -> "null"
                else -> "unknown"
            }
            "$cameraId=$facing"
        }
    } catch (e: Exception) {
        "error:${e.message}"
    }
}

fun hasUsbCamera(context: Context): Boolean {
    try {
        val cameraManager =
            context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager

        for (cameraId in cameraManager.cameraIdList) {
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val lensFacing = characteristics.get(
                android.hardware.camera2.CameraCharacteristics.LENS_FACING
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val capabilities = characteristics.get(
                    android.hardware.camera2.CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES
                )
                if (capabilities?.contains(android.hardware.camera2.CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_SYSTEM_CAMERA) == true) {
                    return true
                }
            }

            if (lensFacing == null) return true
        }
        return false
    } catch (e: Exception) {
        CrashReporter.recordException(e, "InternalCameraView")
        return false
    }
}

// Camera ids at or above this come from the external (USB) camera provider.
private const val EXTERNAL_CAMERA_ID_BASE = 100

// The kiosk mini PC's panel is natively landscape and mounted upright; its system rotation is locked
// to 90 (outside the app the UI is upright). A manifest `portrait` request maps to rotation 270 on
// this device — 180 degrees the other way — so the screen flips upside-down the moment the app
// opens. For exactly that device (natively landscape panel + external camera + system rotation
// locked to 90) ask for REVERSE_PORTRAIT instead, which Android maps to rotation 90. Returns null
// for everything else so the manifest's `portrait` stays in force there.
fun kioskReversePortraitOrientation(context: Context): Int? {
    return try {
        @Suppress("DEPRECATION")
        val display = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val size = android.graphics.Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)
        val rotated = display.rotation == Surface.ROTATION_90 || display.rotation == Surface.ROTATION_270
        // Real size is reported in the current rotation; swap back to get the natural one.
        val naturalLandscape = if (rotated) size.y > size.x else size.x > size.y
        val systemRotation = android.provider.Settings.System.getInt(
            context.contentResolver,
            android.provider.Settings.System.USER_ROTATION,
            Surface.ROTATION_0
        )
        if (naturalLandscape && systemRotation == Surface.ROTATION_90 && hasExternalCamera(context)) {
            android.content.pm.ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
        } else {
            null
        }
    } catch (e: Exception) {
        null
    }
}

// True for a natively landscape panel the OS is holding portrait (display rotation 90/270 while the
// real display size reads portrait). A natively portrait phone/tablet never satisfies this — at
// rotation 90/270 its real size reads landscape — so those keep the standard code path.
fun isLandscapePanelInPortrait(context: Context): Boolean {
    return try {
        @Suppress("DEPRECATION")
        val display = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val rotation = display.rotation
        if (rotation != Surface.ROTATION_90 && rotation != Surface.ROTATION_270) return false
        val size = android.graphics.Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)
        size.y > size.x
    } catch (e: Exception) {
        false
    }
}

// USB/UVC modules come from Android's external camera provider. They usually report
// LENS_FACING_EXTERNAL (see resolveCameraSelector), but the BigdroidOS mini PC's module reports
// FRONT instead — what still marks it is its camera id, because the external provider numbers
// its devices from 100, while built-in phone cameras are 0, 1, 2... So match either signal;
// a phone's built-in cameras satisfy neither, which keeps the kiosk-only rotation off them.
fun hasExternalCamera(context: Context): Boolean {
    return try {
        val cameraManager =
            context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
        cameraManager.cameraIdList.any { cameraId ->
            val isExternalId = (cameraId.toIntOrNull() ?: 0) >= EXTERNAL_CAMERA_ID_BASE
            isExternalId || cameraManager.getCameraCharacteristics(cameraId)
                .get(android.hardware.camera2.CameraCharacteristics.LENS_FACING) ==
                android.hardware.camera2.CameraCharacteristics.LENS_FACING_EXTERNAL
        }
    } catch (e: Exception) {
        false
    }
}

private fun currentSurfaceRotation(context: Context): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.display?.rotation ?: Surface.ROTATION_0
    } else {
        @Suppress("DEPRECATION")
        (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
    }
}

// CameraX's CameraSelector.LENS_FACING_* constants are numerically identical to
// CameraCharacteristics.LENS_FACING_* (both FRONT=0, BACK=1), so lensFacing can be
// compared against LENS_FACING directly without translation.
fun queryOutputPictureSizes(context: Context, lensFacing: Int): List<Size> {
    return try {
        val cameraManager =
            context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager

        val matchingCameraId = cameraManager.cameraIdList.firstOrNull { cameraId ->
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            characteristics.get(android.hardware.camera2.CameraCharacteristics.LENS_FACING) == lensFacing
        } ?: cameraManager.cameraIdList.firstOrNull() ?: return emptyList()

        val characteristics = cameraManager.getCameraCharacteristics(matchingCameraId)
        val streamMap = characteristics.get(
            android.hardware.camera2.CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP
        ) ?: return emptyList()

        streamMap.getOutputSizes(android.graphics.ImageFormat.JPEG)
            ?.distinct()
            ?.sortedByDescending { it.width.toLong() * it.height.toLong() }
            ?: emptyList()
    } catch (e: Exception) {
        Log.e("InternalCameraView", "Failed to query device picture sizes", e)
        emptyList()
    }
}

suspend fun fixImageRotationFromUri(
    context: Context,
    imageUri: Uri,
    cameraResultRotation: Int = 0,
    isFrontCamera: Boolean = false,
    // Only camera captures have the "landscape raw buffer with no/unreliable EXIF" problem
    // that the width>height fallback below works around. Gallery- and QR-sourced images can
    // be legitimately landscape, so applying that fallback to them force-rotates otherwise
    // correct photos — this is what caused kiosk gallery/QR uploads to come out sideways.
    applyOrientationFallback: Boolean = true,
    // Baked into the saved pixels so the try-on input matches what the customer saw in preview.
    filter: CameraFilterOption = CameraFilterOption.ORIGINAL,
    adjustments: FilterAdjustments = FilterAdjustments()
): Uri = withContext(Dispatchers.IO) {
    try {
        val inputStream = context.contentResolver.openInputStream(imageUri) ?: return@withContext imageUri

        val tempFile = File(context.cacheDir, "fixed_${System.currentTimeMillis()}.jpg")
        FileOutputStream(tempFile).use { out ->
            inputStream.copyTo(out)
        }
        inputStream.close()

        val exif = ExifInterface(tempFile.absolutePath)
        val orientation = exif.getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL
        )

        val isUsbOrKiosk = hasUsbCamera(context) || isKioskDevice(context)

        var rotationDegrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }

        // This app only ever wants portrait photos out of the camera. A landscape-shaped raw
        // buffer gets straightened to portrait when EXIF gives no rotation hint — some kiosk/USB
        // camera HALs report no orientation metadata at all. Trust the EXIF value CameraX wrote
        // (the standard interpretation) and only guess via buffer shape when EXIF gave nothing
        // to work with. Checked via a bounds-only decode (reads just the JPEG header, no pixel
        // data) since at this point we don't yet know whether a transform is even needed.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(tempFile.absolutePath, bounds)

        // Landscape-native kiosk panel (e.g. the BigdroidOS mini PC) held portrait by the OS, with a
        // USB camera. CameraX derives the EXIF tag from the display rotation, so EXIF already
        // tracks which way the panel is turned (270 vs 90). Apply it once, then crop to portrait
        // below, and never run the "wider than tall => 90" guess — that guess is what turned an
        // already-corrected frame into a sideways/upside-down one on the second pass
        // (PhotoEditView re-runs this function on the file this one produced).
        // Gated on a non-zero EXIF tag so a file this function already wrote (tag reset to NORMAL)
        // is left alone instead of being corrected twice.
        // Measured on the device: EXIF alone comes out upright with the camera on the top edge. If
        // the camera is ever re-mounted upside down, add a fixed rotation offset here.
        // Deliberately not gated on isKioskDevice(): this unit isn't classified as a kiosk by that
        // heuristic (no leanback feature, not device owner), yet it is exactly the target. A
        // natively landscape panel held portrait plus an external camera is specific enough.
        val kioskLandscapePanel = applyOrientationFallback &&
            rotationDegrees != 0 &&
            isLandscapePanelInPortrait(context) &&
            hasExternalCamera(context)

        Log.i(
            "InternalCameraView",
            "orientation fix: exifDeg=$rotationDegrees bounds=${bounds.outWidth}x${bounds.outHeight} " +
                "fallback=$applyOrientationFallback kiosk=$isUsbOrKiosk " +
                "landscapePanelInPortrait=${isLandscapePanelInPortrait(context)} " +
                "externalCamera=${hasExternalCamera(context)} -> kioskBranch=$kioskLandscapePanel"
        )

        // No extra offset at display rotation 90 (reverse portrait, see
        // kioskReversePortraitOrientation): capture.targetRotation is set to the live display
        // rotation, so CameraX's EXIF tag already follows the turn and applying it alone matches
        // the preview. An added +180 here made captures come out upside-down on the mini PC.

        if (!kioskLandscapePanel && rotationDegrees == 0 && applyOrientationFallback && bounds.outWidth > bounds.outHeight) {
            rotationDegrees = 90
        }

        val shouldMirror = isFrontCamera && !isUsbOrKiosk

        val needsGrading = !(filter.isOriginal && adjustments.isNeutral)
        if (rotationDegrees == 0 && !shouldMirror && !needsGrading && !kioskLandscapePanel) {
            return@withContext FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                tempFile
            )
        }

        // Only pay for a full pixel decode once a transform is actually needed — this is the
        // expensive step, and scales with the capture resolution.
        val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath) ?: return@withContext imageUri

        val matrix = Matrix()

        if (rotationDegrees != 0) {
            matrix.postRotate(rotationDegrees.toFloat())
        }

        if (shouldMirror) {
            matrix.postScale(
                -1f,
                1f,
                bitmap.width / 2f,
                bitmap.height / 2f
            )
        }

        var fixedBitmap = Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true
        )
        // Full-resolution capture — the source is no longer needed once the transformed copy
        // exists, and freeing it here (rather than leaving both alive through the compress
        // step below) is what keeps this from holding two full-size bitmaps in memory at once
        // on every single photo capture.
        // (createBitmap returns the source itself for an identity matrix, so don't recycle then.)
        if (fixedBitmap !== bitmap) bitmap.recycle()

        // The sensor is a 16:9 landscape frame, so once it is upright it is still wider than the
        // portrait the rest of the app expects. Centre-crop to 9:16 — scaling it to fit would stretch
        // the person, which is exactly the distortion this branch exists to avoid.
        if (kioskLandscapePanel && fixedBitmap.width * 16 > fixedBitmap.height * 9) {
            val cropWidth = (fixedBitmap.height * 9 / 16) and 1.inv()
            val cropLeft = (fixedBitmap.width - cropWidth) / 2
            val cropped = Bitmap.createBitmap(fixedBitmap, cropLeft, 0, cropWidth, fixedBitmap.height)
            if (cropped !== fixedBitmap) fixedBitmap.recycle()
            fixedBitmap = cropped
        }

        if (needsGrading) {
            val filtered = Bitmap.createBitmap(fixedBitmap.width, fixedBitmap.height, Bitmap.Config.ARGB_8888)
            val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply {
                // enhance = true: the saved photo gets a small extra contrast/saturation lift on
                // top of the look, so it reads a bit richer than the live preview. (No effect on
                // Original, so an adjusted Original is exactly what the sliders showed.)
                colorFilter = ColorMatrixColorFilter(colorMatrixFor(filter, adjustments, enhance = true))
            }
            AndroidCanvas(filtered).drawBitmap(fixedBitmap, 0f, 0f, paint)
            fixedBitmap.recycle()
            fixedBitmap = filtered
            // Order matches the preview: colour first, then the vignette over it; sharpening
            // last so it works on the final tones.
            applyVignette(fixedBitmap, adjustments.vignette)
            if (adjustments.hasSharpness) fixedBitmap = applySharpness(fixedBitmap, adjustments.sharpness)
        }

        FileOutputStream(tempFile).use { out ->
            fixedBitmap.compress(Bitmap.CompressFormat.JPEG, CAPTURE_JPEG_QUALITY, out)
        }

        val newExif = ExifInterface(tempFile.absolutePath)
        newExif.setAttribute(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL.toString()
        )
        newExif.saveAttributes()

        FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            tempFile
        )

    } catch (t: Throwable) {
        CrashReporter.recordException(t, "InternalCameraView")
        imageUri
    }
}

@Preview(name = "Internal Camera - Phone", showBackground = true, widthDp = 375, heightDp = 667)
@Composable
private fun InternalCameraViewPreview() {
    AiVastraTheme {
        InternalCameraView(onBack = {}, onPhotoCaptured = {})
    }
}

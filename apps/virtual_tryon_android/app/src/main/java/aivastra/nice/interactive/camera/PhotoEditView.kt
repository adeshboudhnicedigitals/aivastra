package aivastra.nice.interactive.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

@Composable
fun PhotoEditView(
    photoUri: Uri,
    onCancel: () -> Unit,
    onConfirmEdit: (Uri) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val isPreview = LocalInspectionMode.current
    val scope = rememberCoroutineScope()
    val statusBarH: Dp = if (isPreview) 28.dp else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navBarH: Dp = if (isPreview) 14.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    var sourceBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var rotationDegrees by remember { mutableIntStateOf(0) }
    var scale by remember { mutableFloatStateOf(1.0f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var containerSize by remember { mutableStateOf<IntSize?>(null) }
    var isProcessing by remember { mutableStateOf(false) }

    LaunchedEffect(photoUri) {
        withContext(Dispatchers.IO) {
            try {
                val fixedUri = fixImageRotationFromUri(
                    context = context,
                    imageUri = photoUri,
                    cameraResultRotation = 0,
                    isFrontCamera = false
                )
                context.contentResolver.openInputStream(fixedUri)?.use { input ->
                    sourceBitmap = BitmapFactory.decodeStream(input)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top Bar with status bar inset handling
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color(0xFF382717), Color(0xFF1B120B))
                        )
                    )
                    .border(
                        width = sdp(R.dimen._1sdp),
                        color = Color(0xFFB97A1E).copy(alpha = 0.50f),
                        shape = RoundedCornerShape(0.dp)
                    )
                    .padding(top = statusBarH)
                    .height(sdp(R.dimen._55sdp))
                    .padding(horizontal = sdp(R.dimen._16sdp)),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = onCancel,
                    enabled = !isProcessing
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Cancel Edit",
                        tint = Color.White,
                        modifier = Modifier.size(sdp(R.dimen._22sdp))
                    )
                }

                Text(
                    "Edit Photo",
                    color = Color.White,
                    fontSize = ssp(R.dimen._18ssp),
                    fontWeight = FontWeight.Bold,
                    fontFamily = PoppinsFamily
                )

                IconButton(
                    onClick = {
                        if (!isProcessing && sourceBitmap != null) {
                            isProcessing = true
                            processAndSaveEditedBitmap(
                                context = context,
                                scope = scope,
                                bitmap = sourceBitmap!!,
                                rotation = rotationDegrees,
                                scale = scale,
                                offset = offset,
                                containerSize = containerSize,
                                onResult = { editedUri ->
                                    isProcessing = false
                                    if (editedUri != null) {
                                        onConfirmEdit(editedUri)
                                    } else {
                                        onConfirmEdit(photoUri)
                                    }
                                }
                            )
                        }
                    },
                    enabled = !isProcessing
                ) {
                    if (isProcessing) {
                        CircularProgressIndicator(
                            color = Color(0xFFF2B53F),
                            strokeWidth = sdp(R.dimen._2sdp),
                            modifier = Modifier.size(sdp(R.dimen._20sdp))
                        )
                    } else {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = "Confirm Edit",
                            tint = Color(0xFFF2B53F),
                            modifier = Modifier.size(sdp(R.dimen._26sdp))
                        )
                    }
                }
            }

            // Interactive Preview Area
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                val bitmap = sourceBitmap
                if (bitmap != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.92f)
                            .aspectRatio(3f / 4f)
                            .clip(RoundedCornerShape(sdp(R.dimen._12sdp)))
                            .background(Color(0xFF19110A))
                            .border(
                                width = sdp(R.dimen._1sdp),
                                color = Color(0xFFB97A1E).copy(alpha = 0.50f),
                                shape = RoundedCornerShape(sdp(R.dimen._12sdp))
                            )
                            .onGloballyPositioned { coordinates ->
                                containerSize = coordinates.size
                            }
                            .pointerInput(isProcessing) {
                                if (!isProcessing) {
                                    detectTransformGestures { _, pan, zoom, _ ->
                                        scale = (scale * zoom).coerceIn(0.5f, 3.0f)
                                        offset = Offset(
                                            x = offset.x + pan.x,
                                            y = offset.y + pan.y
                                        )
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = "Photo Preview",
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = scale
                                    scaleY = scale
                                    rotationZ = rotationDegrees.toFloat()
                                    translationX = offset.x
                                    translationY = offset.y
                                }
                        )

                        // 3x3 Grid Overlay
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val w = size.width
                            val h = size.height
                            val strokeWidth = 1.dp.toPx()
                            val lineColor = Color.White.copy(alpha = 0.45f)

                            drawLine(
                                color = lineColor,
                                start = Offset(w / 3, 0f),
                                end = Offset(w / 3, h),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = lineColor,
                                start = Offset(w * 2 / 3, 0f),
                                end = Offset(w * 2 / 3, h),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = lineColor,
                                start = Offset(0f, h / 3),
                                end = Offset(w, h / 3),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = lineColor,
                                start = Offset(0f, h * 2 / 3),
                                end = Offset(w, h * 2 / 3),
                                strokeWidth = strokeWidth
                            )
                        }
                    }
                } else {
                    CircularProgressIndicator(color = Color(0xFFF2B53F))
                }
            }

            // Controls Area
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF1B120B))
                    .padding(top = sdp(R.dimen._12sdp), bottom = sdp(R.dimen._14sdp) + navBarH),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val percentage = (scale * 100).toInt()
                Text(
                    text = "$percentage%",
                    color = Color(0xFFF2B53F),
                    fontSize = ssp(R.dimen._14ssp),
                    fontWeight = FontWeight.Bold,
                    fontFamily = PoppinsFamily
                )

                Spacer(Modifier.height(sdp(R.dimen._4sdp)))

                Slider(
                    value = scale,
                    onValueChange = { scale = it },
                    valueRange = 0.5f..3.0f,
                    colors = SliderDefaults.colors(
                        thumbColor = Color(0xFFF2B53F),
                        activeTrackColor = Color(0xFFF2B53F),
                        inactiveTrackColor = Color.Gray.copy(alpha = 0.5f)
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = sdp(R.dimen._24sdp))
                )

                Spacer(Modifier.height(sdp(R.dimen._8sdp)))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(sdp(R.dimen._52sdp))
                        .background(Color(0xFF120C07))
                        .padding(horizontal = sdp(R.dimen._24sdp)),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.clickable {
                            rotationDegrees = (rotationDegrees + 90) % 360
                        }
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Rotate",
                            tint = Color.White,
                            modifier = Modifier.size(sdp(R.dimen._22sdp))
                        )
                    }

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(sdp(R.dimen._22sdp))
                                .clip(RoundedCornerShape(sdp(R.dimen._4sdp)))
                                .background(Color(0xFFF2B53F)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "⤢",
                                color = Color.Black,
                                fontSize = ssp(R.dimen._12ssp),
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Spacer(Modifier.height(sdp(R.dimen._2sdp)))
                        Text(
                            "Scale",
                            color = Color(0xFFF2B53F),
                            fontSize = ssp(R.dimen._10ssp),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = PoppinsFamily
                        )
                    }

                    Spacer(Modifier.width(sdp(R.dimen._22sdp)))
                }
            }
        }
    }
}

private fun processAndSaveEditedBitmap(
    context: Context,
    scope: CoroutineScope,
    bitmap: Bitmap,
    rotation: Int,
    scale: Float,
    offset: Offset,
    containerSize: IntSize?,
    onResult: (Uri?) -> Unit
) {
    scope.launch(Dispatchers.IO) {
        try {
            val hasEdits = rotation != 0 || kotlin.math.abs(scale - 1.0f) > 0.02f || kotlin.math.abs(offset.x) > 2f || kotlin.math.abs(offset.y) > 2f

            val finalBitmap = if (!hasEdits) {
                bitmap
            } else {
                val rotatedBitmap = if (rotation != 0) {
                    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
                    Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                } else {
                    bitmap
                }

                val srcW = rotatedBitmap.width.toFloat()
                val srcH = rotatedBitmap.height.toFloat()

                if (containerSize != null && containerSize.width > 0 && containerSize.height > 0) {
                    val containerW = containerSize.width.toFloat()
                    val containerH = containerSize.height.toFloat()

                    val baseScale = minOf(containerW / srcW, containerH / srcH)
                    val totalScale = (baseScale * scale).coerceAtLeast(0.001f)

                    val cropLeftFloat = (srcW / 2f) - (containerW / 2f + offset.x) / totalScale
                    val cropTopFloat = (srcH / 2f) - (containerH / 2f + offset.y) / totalScale
                    val cropWidthFloat = containerW / totalScale
                    val cropHeightFloat = containerH / totalScale

                    val left = cropLeftFloat.toInt().coerceIn(0, (srcW - 1f).coerceAtLeast(0f).toInt())
                    val top = cropTopFloat.toInt().coerceIn(0, (srcH - 1f).coerceAtLeast(0f).toInt())
                    val right = (left + cropWidthFloat.toInt()).coerceIn(left + 1, srcW.toInt())
                    val bottom = (top + cropHeightFloat.toInt()).coerceIn(top + 1, srcH.toInt())
                    val width = (right - left).coerceAtLeast(1)
                    val height = (bottom - top).coerceAtLeast(1)

                    Bitmap.createBitmap(rotatedBitmap, left, top, width, height)
                } else {
                    rotatedBitmap
                }
            }

            val file = File(context.cacheDir, "edited_photo_${System.currentTimeMillis()}.jpg")
            FileOutputStream(file).use { out ->
                finalBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
            withContext(Dispatchers.Main) {
                onResult(Uri.fromFile(file))
            }
        } catch (e: Exception) {
            e.printStackTrace()
            withContext(Dispatchers.Main) {
                onResult(null)
            }
        }
    }
}

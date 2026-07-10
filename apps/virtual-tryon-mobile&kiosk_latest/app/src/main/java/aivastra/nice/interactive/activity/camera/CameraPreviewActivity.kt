package aivastra.nice.interactive.activity.camera

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.customview.MyDeviceAdminReceiver
import aivastra.nice.interactive.databinding.ActivityCameraPreviewBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.ExifInterface
import android.media.MediaActionSound
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import android.view.MotionEvent
import android.view.View
import android.view.animation.AlphaAnimation
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.yalantis.ucrop.UCrop
import com.yalantis.ucrop.util.FileUtils
import jp.co.cyberagent.android.gpuimage.GPUImage
import jp.co.cyberagent.android.gpuimage.filter.GPUImageBilateralBlurFilter
import jp.co.cyberagent.android.gpuimage.filter.GPUImageBrightnessFilter
import jp.co.cyberagent.android.gpuimage.filter.GPUImageFilterGroup
import jp.co.cyberagent.android.gpuimage.filter.GPUImageSharpenFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraPreviewActivity : BaseActivity() {

    private lateinit var binding: ActivityCameraPreviewBinding
    private lateinit var cameraProvider: ProcessCameraProvider
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var camera:Camera
    private var vastraFor: String = "women"
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null

    private var imageCapture: ImageCapture? = null
    private var lensFacing = CameraSelector.LENS_FACING_FRONT
    private var handler: Handler? = null
    private var countdownRunnable: Runnable? = null
    private val cameraPermissions = arrayOf(
        Manifest.permission.CAMERA
    )
    // Only request WRITE_EXTERNAL_STORAGE for Android 9 and below
    private val legacyStoragePermissions = arrayOf(
        Manifest.permission.WRITE_EXTERNAL_STORAGE
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCameraPreviewBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        vastraFor = intent?.extras?.getString(AppConstant.VASTRA_FOR).toString()
        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            selectedVastraSubCategory = intent?.extras?.getSerializable(
                AppConstant.SELECTED_VASTRA_SUBCAT,
                DressesTypeDataModel.Data.Subcategory::class.java)!!
        }else{
            selectedVastraSubCategory= intent.extras?.getSerializable(AppConstant.SELECTED_VASTRA_SUBCAT) as DressesTypeDataModel.Data.Subcategory
        }
        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            selectedVastraItem = intent?.extras?.getSerializable(
                AppConstant.SELECTED_VASTRA_ITEM,
                DressesTypeDataModel.Data.Subcategory.Item::class.java)!!
        }else{
            selectedVastraItem= intent.extras?.getSerializable(AppConstant.SELECTED_VASTRA_ITEM) as DressesTypeDataModel.Data.Subcategory.Item
        }
        ViewControll.setCompanyLogoHorizontal(this,binding.llToolbar.appLogo)
        try{
            if (Build.VERSION.SDK_INT >= 34) {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val admin = ComponentName(this, MyDeviceAdminReceiver::class.java)
                dpm.setCameraDisabled(admin, false)
            }
        }catch (e:Exception){
            e.printStackTrace()
        }

        lensFacing = getDefaultCameraLensFacing()  //Android14 kiosk enable this line
//        lensFacing = getBestCameraOrFrontIfEqual(this)
//        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1)
        cameraExecutor = Executors.newSingleThreadExecutor()
        binding.previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        requestCameraPermissions()
        setupTapToFocus()
        binding.buttonCapture.setOnClickListener {
            stopCountdown()
            takePhoto()
        }
        binding.btnFlipCamera.setOnClickListener {
            lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK)
                CameraSelector.LENS_FACING_FRONT
            else CameraSelector.LENS_FACING_BACK
            setupCamera()
        }
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
    }

    private fun requestCameraPermissions() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            // Android 9 or lower
            val allGranted = legacyStoragePermissions.all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            } && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

            if (!allGranted) {
                permissionLauncher.launch(legacyStoragePermissions + cameraPermissions)
                return
            }
        }else{
            // Android 10+
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                permissionLauncher.launch(cameraPermissions)
                return
            }
        }
        // If permissions granted -> open camera
        setupCamera()
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if(result.values.all { it }){
            setupCamera()
        }else{
            ViewControll.showMessage(this,"Permission required to use camera")
            finish()
        }
    }

    private fun setupCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases()
        }, ContextCompat.getMainExecutor(this))
    }

    private fun bindCameraUseCases() {
        val preview = Preview.Builder().build()
        imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .setJpegQuality(100)
            .build()
        var cameraSelector = CameraSelector.Builder()
            .requireLensFacing(lensFacing)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {  //condition check for in kiosk14
            // use extensions
            // ✅ Use extensions ONLY on Android 10+
            val extMgrFuture = ExtensionsManager.getInstanceAsync(this, cameraProvider)
            extMgrFuture.addListener({
                val extMgr = extMgrFuture.get()
                val modesPriority = listOf(
                    ExtensionMode.BOKEH,
                    ExtensionMode.FACE_RETOUCH,
                    ExtensionMode.HDR,
                    ExtensionMode.AUTO,
                    ExtensionMode.NIGHT
                )
                for (mode in modesPriority) {
                    if (extMgr.isExtensionAvailable(cameraSelector, mode)) {
                        cameraSelector =
                            extMgr.getExtensionEnabledCameraSelector(cameraSelector, mode)
                        Log.d("CameraX", "Using extension: $mode")
                        break
                    }
                }
                cameraProvider.unbindAll()
                camera =
                    cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
                preview.setSurfaceProvider(binding.previewView.surfaceProvider)
                applyDefaultExposure()
                startCountdown()
            }, ContextCompat.getMainExecutor(this))
        }else{

            // ✅ Android 8 / 9 fallback (NO extensions)
            cameraProvider.unbindAll()
            camera = cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
            preview.setSurfaceProvider(binding.previewView.surfaceProvider)
            applyDefaultExposure()
            startCountdown()
        }
    }

    private fun checkHardWareLegacyInAndroid14(): Boolean {
        val cameraManager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraIds = cameraManager.cameraIdList
        for(id in cameraIds){
            try {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val hardwareLevel = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
                if (hardwareLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
                    return false
                }else{
                    return true
                }
            } catch (e: Exception) {
                return true
            }
        }
        return false
    }

    private fun applyDefaultExposure() {
        try {
            val exposureState = camera.cameraInfo.exposureState ?: return

            val range = exposureState.exposureCompensationRange

            // Some devices return an empty or unsupported range
            if (range.lower <= 0 && range.upper >= 0) {
                camera.cameraControl.setExposureCompensationIndex(0)
            }

        } catch (e: Exception) {
            // Never crash camera for exposure
            e.printStackTrace()
        }
    }

    private fun lockFocusAndExposure(onLocked: () -> Unit) {
        // 1️⃣ Camera must be ready
        if (!::camera.isInitialized) {
            onLocked()
            return
        }
        val previewView = binding.previewView

        if (previewView.width == 0 || previewView.height == 0) {
            onLocked()
            return
        }

        try {
            val factory = previewView.meteringPointFactory

            val centerPoint = factory.createPoint(
                previewView.width / 2f,
                previewView.height / 2f
            )

            val action = FocusMeteringAction.Builder(
                centerPoint,
                FocusMeteringAction.FLAG_AF or
                        FocusMeteringAction.FLAG_AE or
                        FocusMeteringAction.FLAG_AWB
            )
                .setAutoCancelDuration(5, java.util.concurrent.TimeUnit.SECONDS)
                .build()

            camera.cameraControl
                .startFocusAndMetering(action)
                .addListener(
                    { onLocked() },
                    ContextCompat.getMainExecutor(this)
                )

        } catch (e: Exception) {
            e.printStackTrace()
            onLocked()
        }
    }

    private fun getDefaultCameraLensFacing(): Int {
        return try {
            val cameraManager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val cameraIds = cameraManager.cameraIdList

            // If no cameras found
            if (cameraIds.isNullOrEmpty()) {
                showOnMain(this, "No camera IDs — using BACK as fallback")
                return CameraSelector.LENS_FACING_BACK
            }

            var hasBack = false
            var hasFront = false

            for (id in cameraIds) {
                try {
                    val characteristics = cameraManager.getCameraCharacteristics(id)
                    val lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING)

                    if (lensFacing == CameraCharacteristics.LENS_FACING_BACK) hasBack = true
                    if (lensFacing == CameraCharacteristics.LENS_FACING_FRONT) hasFront = true

                } catch (e: Exception) {
                    showOnMain(this, "Camera characteristics error: ${e.message}")
                }
            }

            // Priority: BACK → FRONT
            when {
                hasBack -> CameraSelector.LENS_FACING_BACK
                hasFront -> CameraSelector.LENS_FACING_FRONT
                else -> {
                    showOnMain(this, "No valid cameras — using BACK")
                    CameraSelector.LENS_FACING_BACK
                }
            }
        } catch (e: Exception) {
            showOnMain(this, "Camera error: ${e.message}")
            CameraSelector.LENS_FACING_BACK
        }
    }

    fun getBestCameraOrFrontIfEqual(context: Context): Int {
        return try {

            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val cameraIds = cameraManager.cameraIdList

            if (cameraIds.isNullOrEmpty()) {
                // No cameras → fallback to front
                return CameraSelector.LENS_FACING_FRONT
            }

            var frontScore = 0L
            var backScore = 0L
            var hasFront = false
            var hasBack = false

            for (id in cameraIds) {
                try {
                    val cc = cameraManager.getCameraCharacteristics(id)
                    val lens = cc.get(CameraCharacteristics.LENS_FACING) ?: continue

                    if (lens == CameraCharacteristics.LENS_FACING_FRONT) hasFront = true
                    if (lens == CameraCharacteristics.LENS_FACING_BACK) hasBack = true

                    // 1) Resolution score
                    val pixelArray = cc.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
                    val resolution = pixelArray?.width?.toLong()?.times(pixelArray.height) ?: 0L

                    // 2) Sensor area score
                    val sensorSize = cc.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
                    val sensorArea = sensorSize?.width?.times(sensorSize.height) ?: 0f

                    // 3) Hardware score
                    val hardware = cc.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL) ?: 0
                    val hardwareScore = when (hardware) {
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> 900
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> 800
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> 500
                        else -> 300
                    }

                    val score = (resolution / 1_000_000) + sensorArea.toLong() + hardwareScore

                    if (lens == CameraCharacteristics.LENS_FACING_FRONT) {
                        frontScore += score
                    } else if (lens == CameraCharacteristics.LENS_FACING_BACK) {
                        backScore += score
                    }

                } catch (e: Exception) {
                    // Prevent crash for each camera
                    e.printStackTrace()
                }
            }

            // 🔥 No back camera at all → front
            if (!hasBack && hasFront) return CameraSelector.LENS_FACING_FRONT

            // 🔥 No front camera at all → back
            if (!hasFront && hasBack) return CameraSelector.LENS_FACING_BACK

            // 🔥 Both available → Compare
            return when {
                backScore > frontScore -> CameraSelector.LENS_FACING_BACK
                frontScore > backScore -> CameraSelector.LENS_FACING_FRONT
                else -> CameraSelector.LENS_FACING_FRONT   // 🔥 Equal → front
            }

        } catch (ex: Exception) {
            ex.printStackTrace()

            // 🔥 Final fallback to FRONT (never crash)
            CameraSelector.LENS_FACING_FRONT
        }
    }

    private fun showOnMain(context: Activity, message: String) {
        Handler(Looper.getMainLooper()).post {
            ViewControll.showMessage(context, message)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTapToFocus() {
        binding.previewView.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_UP) {
                val point = binding.previewView.meteringPointFactory.createPoint(event.x, event.y)
                val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                    .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
                camera.cameraControl.startFocusAndMetering(action)
                showFocusAnimation(event.x, event.y)
            }
            true
        }
    }

    private fun showFocusAnimation(touchX: Float, touchY: Float) {
        val ring = binding.focusRing

        val x = touchX - ring.width / 2
        val y = touchY - ring.height / 2

        ring.apply {
            this.x = x
            this.y = y

            visibility = View.VISIBLE
            scaleX = 1.4f
            scaleY = 1.4f
            alpha = 1f

            animate()
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(120)
                .withEndAction {
                    animate()
                        .alpha(0f)
                        .setDuration(400)
                        .withEndAction { visibility = View.GONE }
                        .start()
                }
                .start()
        }
    }


    private fun takePhoto() {
        val imgCap = imageCapture ?: return
        lockFocusAndExposure {
            val sound = MediaActionSound()
            sound.play(MediaActionSound.SHUTTER_CLICK)
            /* val photoFile = File(
                  getExternalFilesDir(null),
                 "IMG_${System.currentTimeMillis()}.jpg"
             )*/
            val photoFile = createImageFile() ?: return@lockFocusAndExposure
            val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
            Handler(Looper.getMainLooper()).postDelayed({
                imgCap.takePicture(outputOptions, ContextCompat.getMainExecutor(this),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                            val photoURI = FileProvider.getUriForFile(
                                this@CameraPreviewActivity,
                                "${packageName}.provider",
                                photoFile
                            )
                            photoURI?.let { path ->
                                lifecycleScope.launch(Dispatchers.IO) {
                                  val rotationFixedUri = fixImageRotationFromUri(this@CameraPreviewActivity,path)
                                    withContext(Dispatchers.Main) {
                                        if (rotationFixedUri != null) {
                                            startUCropImage(rotationFixedUri)
                                        }else{
                                            startUCropImage(path)
                                        }
                                    }
                                }
                            }
                        }

                        override fun onError(exc: ImageCaptureException) {
                            Log.e("CameraX", "Capture failed", exc)
                        }
                    }
                )
            },500)

        }
    }

    private fun takePhotoKiosk14() {
        val imgCap = imageCapture ?: return
        lockFocusAndExposure {
            val sound = MediaActionSound()
            sound.play(MediaActionSound.SHUTTER_CLICK)
            /* val photoFile = File(
                  getExternalFilesDir(null),
                 "IMG_${System.currentTimeMillis()}.jpg"
             )*/
            val photoFile = createImageFile() ?: return@lockFocusAndExposure
            val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
            Handler(Looper.getMainLooper()).postDelayed({
                imgCap.takePicture(
                    ContextCompat.getMainExecutor(this),
                    object : ImageCapture.OnImageCapturedCallback() {

                        override fun onCaptureSuccess(image: ImageProxy) {

                            lifecycleScope.launch(Dispatchers.IO) {
                                try {
                                    // 🔥 NO recompression, direct save
                                    val uri = saveImageProxyToUri(image)
                                    withContext(Dispatchers.Main) {
                                        startUCropImage(uri)
                                    }

                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                            }
                        }

                        override fun onError(exception: ImageCaptureException) {
                            Log.e("CameraX", "Capture failed", exception)
                        }
                    }
                )
            },500)

        }
    }

    @Throws(IOException::class)
    private fun createImageFile(): File? {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss").format(Date())

//        val dcimDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
        val cameraDir = File(externalCacheDir, "AiVastraCamera")
        if (!cameraDir.exists()) cameraDir.mkdirs()
        return File.createTempFile("IMG_${timeStamp}_", ".jpg", cameraDir)
    }

    fun fixImageRotationFromUri(context: Context, imageUri: Uri): Uri? {
        return try {
            val inputStream = context.contentResolver.openInputStream(imageUri) ?: return imageUri

            val tempFile = File(context.cacheDir, "fixed_${System.currentTimeMillis()}.jpg")
            FileOutputStream(tempFile).use { out -> inputStream.copyTo(out) }
            inputStream.close()


            val exif = ExifInterface(tempFile.absolutePath)
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)

            val rotationDegrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }

//            val isFrontCamera = isFrontCameraImage(tempFile.absolutePath)
            val isFrontCamera = if (lensFacing == CameraSelector.LENS_FACING_BACK){
                false
            }else{
                true
            }

            if (rotationDegrees == 0 && !isFrontCamera) {
                return FileProvider.getUriForFile(context, "${context.packageName}.provider", tempFile)
            }

            val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath)
            val matrix = Matrix()
            if (rotationDegrees != 0) matrix.postRotate(rotationDegrees.toFloat())
            if (isFrontCamera) matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)

            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

            FileOutputStream(tempFile).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
            }

            val newExif = ExifInterface(tempFile.absolutePath)
            newExif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
            newExif.saveAttributes()

            // ✅ Return FileProvider URI
            FileProvider.getUriForFile(context, "${context.packageName}.provider", tempFile)

        } catch (e: Exception) {
            e.printStackTrace()
            imageUri // fallback
        }
    }

    private fun isFrontCameraImage(imagePath: String): Boolean {
        return try {
            val exif = ExifInterface(imagePath)

            // Some devices store front camera as orientation 270 or 90
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED)

            // Check camera lens information (some devices include it)
            val lensMake = exif.getAttribute(ExifInterface.TAG_MAKE) ?: ""
            val lensModel = exif.getAttribute(ExifInterface.TAG_MODEL) ?: ""

            Log.e("Camera2", "Orientation: $orientation, LensMake: $lensMake, LensModel: $lensModel")

            // If orientation is 270 or 90, likely a front camera (some devices)
            return orientation == ExifInterface.ORIENTATION_ROTATE_270 || orientation == ExifInterface.ORIENTATION_ROTATE_90

        }catch (e: Exception) {
            e.printStackTrace()
            false // Assume back camera if unknown
        }
    }

    private fun saveImageProxyToUri(
        image: ImageProxy): Uri {

        val file = File(
            getExternalFilesDir(null),
            "IMG_${System.currentTimeMillis()}.jpg"
        )

        val outputStream = FileOutputStream(file)

        if (image.format == ImageFormat.JPEG) {
            // Direct JPEG stream copy (NO compression loss)
            val buffer = image.planes[0].buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            outputStream.write(bytes)

        } else if (image.format == ImageFormat.YUV_420_888) {
            // High-quality YUV → JPEG conversion (quality 100)
            val yBuffer = image.planes[0].buffer
            val uBuffer = image.planes[1].buffer
            val vBuffer = image.planes[2].buffer

            val ySize = yBuffer.remaining()
            val uSize = uBuffer.remaining()
            val vSize = vBuffer.remaining()

            val nv21 = ByteArray(ySize + uSize + vSize)
            yBuffer.get(nv21, 0, ySize)
            vBuffer.get(nv21, ySize, vSize)
            uBuffer.get(nv21, ySize + vSize, uSize)

            val yuvImage = YuvImage(
                nv21,
                ImageFormat.NV21,
                image.width,
                image.height,
                null
            )

            yuvImage.compressToJpeg(
                Rect(0, 0, image.width, image.height),
                100,   // Maximum quality
                outputStream
            )
        }

        outputStream.close()
        image.close()

        // Return URI for app usage (share, display, upload)
        return FileProvider.getUriForFile(
            this,
            "${packageName}.provider",
            file
        )
    }

    private fun startUCropImage(uri: Uri) {
        try {
            val uniqueFileName = "cropped_${UUID.randomUUID()}.jpg"
            val destinationUri = Uri.fromFile(File(cacheDir, uniqueFileName))

            val intent = UCrop.of(uri, destinationUri)
                .useSourceImageAspectRatio()
                .withOptions(getUCropOptions())
                .getIntent(this)

            uCropActivityResult.launch(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getUCropOptions(): UCrop.Options {
        return UCrop.Options().apply {
            setCompressionFormat(Bitmap.CompressFormat.JPEG)
            setCompressionQuality(100)
        }
    }

    private val uCropActivityResult =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            try {
                if (result.resultCode == RESULT_OK && result.data != null) {
                    val uri = UCrop.getOutput(result.data!!)
                    if (uri != null) {
                        val file = File(FileUtils.getPath(this, uri))
                        gotoNextScreen(file.absolutePath, AppConstant.ISFROM_CAMERA_PHOTO)
                    } else {
                        ViewControll.showMessage(this, "Capture failed. Please try again.")
                    }
                } else if (result.resultCode == UCrop.RESULT_ERROR) {
                    val cropError = UCrop.getError(result.data!!)
                    ViewControll.showMessage(this, "Crop failed: ${cropError?.message}")
                }
            } catch (e: Exception) {
                e.printStackTrace()
                ViewControll.showMessage(this, "Capture failed. Please try again.")
            }
        }

    private fun applyBeautyFilter(bitmap: Bitmap): Bitmap {
        val gpuImage = GPUImage(this)
        gpuImage.setImage(bitmap)
        val smooth = GPUImageBilateralBlurFilter().apply { setDistanceNormalizationFactor(4f) }
        val tone = GPUImageBrightnessFilter().apply { setBrightness(0.05f) }
        val sharpen = GPUImageSharpenFilter().apply { setSharpness(0.3f) }
        val group = GPUImageFilterGroup(listOf(smooth, tone, sharpen))
        gpuImage.setFilter(group)
        return gpuImage.bitmapWithFilterApplied
    }


    private fun gotoNextScreen(capturePhotoFilePath:String,isFrom:String){
        val intent = Intent(this@CameraPreviewActivity, UploadPhotoActivity::class.java)
        intent.putExtra(AppConstant.CAPTURED_PHOTO,capturePhotoFilePath)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        intent.putExtra(AppConstant.IS_FROM,isFrom)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        startActivity(intent)
        finish()
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun startCountdown() {
        val autoTimerSeconds = getTimerSeconds()
        if(autoTimerSeconds==0){
            return
        }
        if(countdownRunnable!=null){
            stopCountdown()
        }
        binding.countdownText.visibility = View.VISIBLE
        binding.capturText.isVisible = true
        var timeLeft = autoTimerSeconds
        handler = Handler(Looper.getMainLooper())
        countdownRunnable = object : Runnable {
            override fun run() {
                if (timeLeft > 0) {
                    binding.countdownText.text = timeLeft.toString()
                    binding.countdownText.animate()
                        .scaleX(1.5f).scaleY(1.5f)
                        .setDuration(500)
                        .withEndAction {
                            binding.countdownText.animate().scaleX(1f).scaleY(1f).duration = 500
                        }
                        .start()
                    timeLeft--
                    handler?.postDelayed(this, 1000)
                } else {
                    stopCountdown()
                    takePhoto() // 🔥 Auto Capture Photo when countdown finishes
                }
            }
        }
        handler?.post(countdownRunnable as Runnable)
    }

    // 🚀 Call this when the button is clicked to stop the countdown
    private fun stopCountdown() {
        countdownRunnable?.let { handler?.removeCallbacks(it) }
        binding.countdownText.visibility = View.GONE
        binding.capturText.isVisible = false
        countdownRunnable = null
        handler = null
    }

    private fun getTimerSeconds(): Int {
        val timerValue = PrefsManager.getString(AppConstant.CAPTURE_TIMER,"10 sec")
        return when {
            timerValue.isNullOrBlank() -> 0
            timerValue.equals("None", true) -> 0
            else -> timerValue.substringBefore(" ").toIntOrNull() ?: 0
        }
    }

    override fun onResume() {
        super.onResume()
        if (::camera.isInitialized) {
           startCountdown()
        }
    }

    override fun onPause() {
        super.onPause()
        stopCountdown()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopCountdown()
        cameraExecutor.shutdown()
    }
}



package aivastra.nice.interactive.activity.camera

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityUniversalCameraBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.Manifest
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.otaliastudios.cameraview.CameraException
import com.otaliastudios.cameraview.CameraListener
import com.otaliastudios.cameraview.CameraOptions
import com.otaliastudios.cameraview.controls.Audio
import com.otaliastudios.cameraview.controls.Engine
import com.otaliastudios.cameraview.controls.Facing
import com.otaliastudios.cameraview.controls.Flash
import com.otaliastudios.cameraview.controls.Hdr
import com.otaliastudios.cameraview.controls.Mode
import com.otaliastudios.cameraview.controls.PictureFormat
import com.otaliastudios.cameraview.controls.Preview
import com.otaliastudios.cameraview.controls.WhiteBalance
import com.otaliastudios.cameraview.filter.NoFilter
import com.otaliastudios.cameraview.size.AspectRatio
import com.otaliastudios.cameraview.size.SizeSelectors
import com.yalantis.ucrop.UCrop
import com.yalantis.ucrop.util.FileUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.UUID

class UniversalCameraActivity : BaseActivity() {
    private lateinit var binding: ActivityUniversalCameraBinding
    private var vastraFor: String = "women"
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null
    private val cameraPermissions = arrayOf(
        Manifest.permission.CAMERA
    )
    // Only request WRITE_EXTERNAL_STORAGE for Android 9 and below
    private val legacyStoragePermissions = arrayOf(
        Manifest.permission.WRITE_EXTERNAL_STORAGE
    )
    private var startX = 0f
    private var handler: Handler? = null
    private var countdownRunnable: Runnable? = null
    private var isInitialFacingApplied = false
    private var isCameraSettingChanged = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUniversalCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
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
        applyCameraSetting()
        addFocusRing()
        // Capture button
        binding.buttonCapture.setOnClickListener {
            // This triggers the high-quality capture (respecting picture-size selector).
            stopCountdown()
            LoaderManager.show(this,findViewById(android.R.id.content),true)
            LoaderManager.setMessage("Processing Photo...")
            binding.camera.takePicture()
        }
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
        binding.btnFlipCamera.setOnClickListener {
            binding.camera.toggleFacing()
            // ✅ Get updated facing AFTER toggle
            val newFacing = binding.camera.facing
            if (newFacing == Facing.FRONT) {
                PrefsManager.putString(PrefsManager.KEY_SUPPORTED_CAMERA, "Front Camera")
            } else {
                PrefsManager.putString(PrefsManager.KEY_SUPPORTED_CAMERA, "Back Camera")
            }
        }
        binding.swipeAnimation.llMainRoot.setOnClickListener {
            binding.swipeAnimation.llMainRoot.isVisible = false
        }
        binding.btnCameraSetting.setOnClickListener {
            openSettingScreen()
        }
    }

    private fun applyCameraSetting(){
        binding.camera.apply {
            setLifecycleOwner(this@UniversalCameraActivity)
            mode = Mode.PICTURE
            audio = Audio.OFF
            useDeviceOrientation = true
            pictureFormat = PictureFormat.JPEG
            flash = Flash.OFF
            engine = Engine.CAMERA2
            setPreviewStreamSize(
                SizeSelectors.and(
                    SizeSelectors.aspectRatio(AspectRatio.of(9, 16), 0.15f),
                    SizeSelectors.minWidth(1280),
                    SizeSelectors.biggest()
                )
            )
            setPictureSize(
                SizeSelectors.and(
                    SizeSelectors.maxWidth(4096),
                    SizeSelectors.biggest()
                )
            )
        }
        // add camera listener to receive picture result
        binding.camera.addCameraListener(object : CameraListener() {
            override fun onPictureTaken(result: com.otaliastudios.cameraview.PictureResult) {
                if(binding.camera.isOpened){
                    binding.camera.close()
                }
                // Save to a file (background handled by toFile callback)
                val file = createImageFile()?: return
                result.toFile(file) { savedFile ->
                    val exif = ExifInterface(savedFile!!.absolutePath)

                    Log.e("CaptureDebug", "Rotation = ${result.rotation}")
                    Log.e(
                        "CaptureDebug",
                        "Exif = ${
                            exif.getAttributeInt(
                                ExifInterface.TAG_ORIENTATION,
                                ExifInterface.ORIENTATION_NORMAL
                            )
                        }"
                    )
                    Log.e("CaptureDebug", "Size = ${savedFile.length()}")
                    // savedFile is the File containing the JPEG with rotation fixed, filter applied.
                    val photoURI: Uri? = savedFile?.let {
                        FileProvider.getUriForFile(
                            this@UniversalCameraActivity,
                            "${packageName}.provider",
                            it
                        )
                    }
                    photoURI?.let { path ->
                        lifecycleScope.launch {
//                            val rotationFixedUri = withContext(Dispatchers.IO) {
//                                fixImageRotationFromUri(this@UniversalCameraActivity, path)
//                            }
                            val rotationFixedUri = withContext(Dispatchers.IO) {
                                fixImageRotationFromUri(
                                    this@UniversalCameraActivity,
                                    path,
                                    result.rotation
                                )
                            }

                            if (rotationFixedUri != null) {
                                LoaderManager.remove(this@UniversalCameraActivity)
                                startUCropImage(rotationFixedUri)
                            } else {
                                LoaderManager.remove(this@UniversalCameraActivity)
                                startUCropImage(path)
                            }
                        }
                    }
                }
            }

            override fun onCameraError(exception: CameraException) {
                exception.message?.let {
                    ViewControll.showSnackErrorMsg(this@UniversalCameraActivity, it)
                }
            }

            override fun onCameraOpened(options: CameraOptions) {
                if(!isCameraSettingChanged){
                    if (!isInitialFacingApplied) {
                        val selectedFacing = chooseBestFacing(options.supportedFacing)
                        binding.camera.facing = selectedFacing
                        isInitialFacingApplied = true
                    }
                    binding.btnFlipCamera.isVisible = options.supportedFacing.size > 1
                    configurePreviewForDevice(options)
                }
            }
        })
    }

    private fun updateCameraFromPrefs() {

        val camera = binding.camera

        var needReopen = false

        // FLASH (live)
        val savedFlash = Flash.valueOf(PrefsManager.getString(PrefsManager.KEY_FLASH, Flash.OFF.name).toString())
        camera.flash = savedFlash

        // HDR (live)
        val savedHdr = Hdr.valueOf(PrefsManager.getString(PrefsManager.KEY_HDR, Hdr.OFF.name).toString())
        camera.hdr = savedHdr

        // WHITE BALANCE (live)
        val savedWB = WhiteBalance.valueOf(PrefsManager.getString(PrefsManager.KEY_WB, camera.whiteBalance.name).toString())
        camera.whiteBalance = savedWB

        // ORIENTATION (live)
        camera.useDeviceOrientation = PrefsManager.getBoolean(PrefsManager.KEY_ORIENTATION)

        // ENGINE (requires reopen)
        val savedEngine = Engine.valueOf(PrefsManager.getString(PrefsManager.KEY_ENGINE, camera.engine.name).toString())
        if (savedEngine != camera.engine) {
            camera.engine = savedEngine
            needReopen = true
        }

        // Preview Type (requires reopen)
        val previewType = Preview.valueOf(PrefsManager.getString(PrefsManager.KEY_PREVIEW, camera.preview.name).toString())
        if (previewType != camera.preview) {
            camera.preview = previewType
            needReopen = true
        }

        // FACING (requires reopen)
        val savedFacing = PrefsManager.getString(PrefsManager.KEY_SUPPORTED_CAMERA, camera.facing.name)
        val facing = when(savedFacing){
            "Back Camera" -> Facing.BACK
            "Front Camera" -> Facing.FRONT
            else -> Facing.BACK
        }
        if (facing != camera.facing) {
            camera.facing = facing
            needReopen = true
        }

        // PICTURE SIZE (requires reopen)
        val width = PrefsManager.getInt(PrefsManager.KEY_PIC_WIDTH, 0)
        val height = PrefsManager.getInt(PrefsManager.KEY_PIC_HEIGHT, 0)

        if (width > 0 && height > 0) {
            camera.setPictureSize(
                SizeSelectors.and(
                    SizeSelectors.minWidth(width),
                    SizeSelectors.minHeight(height)
                )
            )
            needReopen = true
        }
        // 🔥 Reopen only once if needed
        if (needReopen) {
            camera.close()
            camera.open()
        }
    }

    private fun openSettingScreen(){
        val intent = Intent(this@UniversalCameraActivity, CameraSettingActivity::class.java)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun chooseBestFacing(supported: Collection<Facing>): Facing {

        // 1️⃣ USB / External camera → no facing concept
        if (supported.size == 1) {
            return supported.first()
        }

        // 2️⃣ Prefer BACK if available
        if (supported.contains(Facing.BACK)) {
            return Facing.BACK
        }

        // 3️⃣ Otherwise FRONT
        if (supported.contains(Facing.FRONT)) {
            return Facing.FRONT
        }

        // 4️⃣ Absolute fallback
        return supported.first()
    }

   /* private fun isKioskDevice(): Boolean {
        return packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
                Build.MANUFACTURER.lowercase().contains("rockchip") ||
                Build.MODEL.lowercase().contains("rk") ||
                Build.DEVICE.lowercase().contains("box") ||
                Build.DEVICE.lowercase().contains("kiosk")
    }*/
   fun isKioskDevice(): Boolean {

       // ✅ 1. Lock Task Mode (REAL kiosk)
       val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
       val isLockTask = am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_LOCKED

       // ✅ 2. Device Owner (enterprise kiosk)
       val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
       val isDeviceOwner = dpm.isDeviceOwnerApp(packageName)

       // ✅ 3. Leanback (Android TV)
       val isTv = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

       // ✅ 4. Custom hardware detection
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

    private fun hasUsbCamera(context: Context): Boolean {
        try{
            val cameraManager =
                context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager

            for (cameraId in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(cameraId)

                // External camera detection (USB)
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

                // Some USB cameras report no lens facing
                if (lensFacing == null) return true
            }
            return false
        }catch (e:Exception){
            e.printStackTrace()
            return false
        }
    }

    private fun isNoSensorDevice(): Boolean {
        return !packageManager.hasSystemFeature(
            PackageManager.FEATURE_SENSOR_ACCELEROMETER
        )
    }

    private fun configurePreviewForDevice(options: CameraOptions) {

        val isUsb = hasUsbCamera(this)
        val isKiosk = isKioskDevice()
        val isMobile = !isUsb && !isKiosk
        val facing = binding.camera.facing

        when {
            // ✅ MOBILE BACK CAMERA → BEST SHARP PREVIEW
            isMobile && facing == Facing.BACK -> {
                binding.camera.preview = Preview.TEXTURE
                binding.camera.filter = NoFilter()
                binding.camera.hdr = Hdr.OFF
                binding.camera.rotation = 0f
            }

            // ✅ MOBILE FRONT CAMERA → BEAUTY / FILTER MODE
            isMobile && facing == Facing.FRONT -> {
                binding.camera.preview = Preview.GL_SURFACE
                binding.camera.hdr = Hdr.OFF
                binding.camera.rotation = 0f
            }

            // ✅ KIOSK / USB CAMERA
            else -> {
                // ✅ KIOSK / USB CAMERA

                binding.camera.preview = Preview.TEXTURE
                binding.camera.filter = NoFilter()
                binding.camera.hdr = Hdr.ON

                // Do not force preview rotation here.
                // Captured image will be fixed using EXIF.
                binding.camera.rotation = 90f

//                binding.camera.preview = Preview.TEXTURE
//                binding.camera.filter = NoFilter()
//                binding.camera.hdr = Hdr.ON
//                binding.camera.rotation = 180f
            }
        }
    }

    private fun requestCameraPermissions(): Boolean {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            // Android 9 or lower
            val allGranted = legacyStoragePermissions.all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            } && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

            if (!allGranted) {
                permissionLauncher.launch(legacyStoragePermissions + cameraPermissions)
                return false
            }
        }else{
            // Android 10+
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                permissionLauncher.launch(cameraPermissions)
                return false
            }
        }
        // If permissions granted -> open camera
        return true
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if(result.values.all { it }) {
            binding.camera.open()
            startCountdown()
        }else{
            ViewControll.showMessage(this,"Permission required to use camera")
        }
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
            }catch (e: Exception) {
                e.printStackTrace()
                ViewControll.showMessage(this, "Capture failed. Please try again.")
            }
        }
//    fun fixImageRotationFromUri(context: Context, imageUri: Uri): Uri? {
fun fixImageRotationFromUri(
    context: Context,
    imageUri: Uri,
    cameraResultRotation: Int
): Uri? {
        return try {
            val inputStream = context.contentResolver.openInputStream(imageUri) ?: return imageUri

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

            val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath) ?: return imageUri

//            val rotationDegrees = if (
//                cameraResultRotation == 180 &&
//                bitmap.width > bitmap.height &&
//                binding.camera.facing == Facing.BACK
//            ) {
//                90
//            } else {
//                when (orientation) {
//                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
//                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
//                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
//                    else -> 0
//                }
//            }

            val rotationDegrees = if (
                cameraResultRotation == 180 &&
                bitmap.width > bitmap.height &&
                binding.camera.facing == Facing.BACK
            ) {
                -90
            } else {
                when (orientation) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            }

//            val rotationDegrees = if (
//                isNoSensorDevice() &&
//                binding.camera.facing == Facing.BACK &&
//                bitmap.width > bitmap.height
//            ) {
//                90
//            } else {
//                when (orientation) {
//                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
//                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
//                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
//                    else -> 0
//                }
//            }

//            val rotationDegrees = when (orientation) {
//                ExifInterface.ORIENTATION_ROTATE_90 -> 90
//                ExifInterface.ORIENTATION_ROTATE_180 -> 180
//                ExifInterface.ORIENTATION_ROTATE_270 -> 270
//                else -> 0
//            }

            val isUsbOrKiosk = hasUsbCamera(context) || isKioskDevice()

            val shouldMirror =
                binding.camera.facing == Facing.FRONT && !isUsbOrKiosk

            Log.e("CameraDebug", "Orientation = $orientation")
            Log.e("CameraDebug", "Rotation = $rotationDegrees")
            Log.e("CameraDebug", "Width = ${bitmap.width}, Height = ${bitmap.height}")
            Log.e("CameraDebug", "isUsbOrKiosk = $isUsbOrKiosk")
            Log.e("CameraDebug", "Facing = ${binding.camera.facing}")

            if (rotationDegrees == 0 && !shouldMirror) {
                return FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.provider",
                    tempFile
                )
            }

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

            val fixedBitmap = Bitmap.createBitmap(
                bitmap,
                0,
                0,
                bitmap.width,
                bitmap.height,
                matrix,
                true
            )

            FileOutputStream(tempFile).use { out ->
                fixedBitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
            }

            val newExif = ExifInterface(tempFile.absolutePath)
            newExif.setAttribute(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL.toString()
            )
            newExif.saveAttributes()

            FileProvider.getUriForFile(
                context,
                "${context.packageName}.provider",
                tempFile
            )

        } catch (e: Exception) {
            e.printStackTrace()
            imageUri
        }
    }

//    fun fixImageRotationFromUri(context: Context, imageUri: Uri): Uri? {
//        return try {
//            val inputStream = context.contentResolver.openInputStream(imageUri) ?: return imageUri
//
//            val tempFile = File(context.cacheDir, "fixed_${System.currentTimeMillis()}.jpg")
//            FileOutputStream(tempFile).use { out -> inputStream.copyTo(out) }
//            inputStream.close()
//
//            val exif = ExifInterface(tempFile.absolutePath)
//            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
//            val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath)
//
//            var rotationDegrees = when (orientation) {
//                ExifInterface.ORIENTATION_ROTATE_90 -> 90
//                ExifInterface.ORIENTATION_ROTATE_180 -> 180
//                ExifInterface.ORIENTATION_ROTATE_270 -> 270
//                else -> 0
//            }
//
////            if (rotationDegrees == 0 && bitmap.width > bitmap.height) {
////                rotationDegrees = -90
////                Log.e("Camera2", "Image is sideways, fixing rotation: $rotationDegrees")
////            }
//
//            val shouldMirror = binding.camera.facing == Facing.FRONT && !hasUsbCamera(context)
//
//           /*val isFrontCamera = if(binding.camera.facing== Facing.FRONT){
//                true
//            }else{
//                false
//            }*/
//
//            if (rotationDegrees == 0 && !shouldMirror) {
//                return FileProvider.getUriForFile(context, "${context.packageName}.provider", tempFile)
//            }
//
//            Log.e("CameraDebug", "Orientation = $orientation")
//            Log.e("CameraDebug", "Rotation = $rotationDegrees")
//            Log.e("CameraDebug", "Width = ${bitmap.width}, Height = ${bitmap.height}")
//            Log.e("CameraDebug", "isKiosk = ${isKioskDevice()}")
//            Log.e("CameraDebug", "Facing = ${binding.camera.facing}")
//
//            val matrix = Matrix()
//
////            if (rotationDegrees != 0 && isKioskDevice()){
////                matrix.postRotate(-rotationDegrees.toFloat())
////            }else{
////                matrix.postRotate(rotationDegrees.toFloat())
////            }
//
//            if (rotationDegrees != 0) {
//                matrix.postRotate(rotationDegrees.toFloat())
//            }
//           /* if (rotationDegrees != 0){
//                matrix.postRotate(-rotationDegrees.toFloat())
//            }*/
//
//            if (shouldMirror) matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
//
//            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
//
//            FileOutputStream(tempFile).use { out ->
//                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
//            }
//
//            val newExif = ExifInterface(tempFile.absolutePath)
//            newExif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
//            newExif.saveAttributes()
//
//            // ✅ Return FileProvider URI
//            FileProvider.getUriForFile(context, "${context.packageName}.provider", tempFile)
//
//
//        } catch (e: Exception) {
//            e.printStackTrace()
//            imageUri // fallback
//        }
//    }

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

    override fun onStart() {
        super.onStart()
        // check permissions
        if(requestCameraPermissions()){
            binding.camera.open()
            startCountdown()
        }
    }

    override fun onStop() {
        binding.camera.close()
        super.onStop()
    }

    private fun addFocusRing(){
        binding.camera.setOnTouchListener { v, event ->
            if (event.action == MotionEvent.ACTION_DOWN) {
                showFocusAnimation(event.x, event.y)
                binding.camera.startAutoFocus(event.x,event.y)
            }
            return@setOnTouchListener false
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

    @Throws(IOException::class)
    private fun createImageFile(): File? {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss").format(Date())

//        val dcimDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
        val cameraDir = File(externalCacheDir, "AiVastraCamera")
        if (!cameraDir.exists()) cameraDir.mkdirs()
        return File.createTempFile("IMG_${timeStamp}_", ".jpg", cameraDir)
    }

    private fun gotoNextScreen(capturePhotoFilePath:String,isFrom:String){
        val intent = Intent(this@UniversalCameraActivity, UploadPhotoActivity::class.java)
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
        if(!binding.camera.isOpened){
            binding.camera.open()
        }
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
                    binding.buttonCapture.performClick() // 🔥 Auto Capture Photo when countdown finishes
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
        if(!binding.camera.isOpened){
            binding.camera.open()
        }
        if(PrefsManager.getBoolean(PrefsManager.SETTING_CHANGED)){
            isCameraSettingChanged = true
            updateCameraFromPrefs()
//            PrefsManager.putBoolean(PrefsManager.SETTING_CHANGED,false)
        }else{
            if (binding.camera.isActivated && binding.camera.isOpened) {
                startCountdown()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        stopCountdown()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopCountdown()
        binding.camera.close()
    }
}

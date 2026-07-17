package aivastra.nice.interactive.activity.camera

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityCapturePhotoBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.dialog.ShowPoseGuideDialog
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.example.facewixlatest.ApiUtils.ApiErrorPresenter
import com.example.facewixlatest.ApiUtils.ApiException
import com.yalantis.ucrop.UCrop
import com.yalantis.ucrop.util.FileUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.UUID

class CapturePhotoActivity : BaseActivity() {

    private lateinit var binding:ActivityCapturePhotoBinding
    private var currentPhotoUri:Uri? = null
    private var vastraFor:String = "women"
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null
    private var isReturningFromCamera = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCapturePhotoBinding.inflate(layoutInflater)
        setContentView(binding.root)
//        initView()
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
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
        ViewControll.setCompanyLogo(this,binding.appLogo)
        /*val qrCodeOfApp = ViewControll.generateQRCodeFromText(getString(R.string.app_name))
           if(qrCodeOfApp!=null){
               binding.imgQrcode.setImageBitmap(qrCodeOfApp)
           }*/
        binding.llTakePhoto.setOnClickListener{
//            checkPermissionsAndStartCamera()
           /* val intent = Intent(this@CapturePhotoActivity, CameraCaptureActivity::class.java)
            intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
            intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
            intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
            startActivity(intent)
            overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)*/
            forKiosk9or12or14()
        }

        binding.llScanPhoto.setOnClickListener {
            resetObserver()
            getQrCodeLinkFromAPI()
        }

        binding.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }

        Handler(Looper.getMainLooper()).postDelayed({
            showPoseGuideDialog()
        },500)
    }

    private fun forKiosk9or12or14(){
        val intent = Intent(this@CapturePhotoActivity, UniversalCameraActivity::class.java)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun forMobileorTab(){
        val intent = Intent(this@CapturePhotoActivity, CameraPreviewActivity::class.java)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    override fun onResume() {
        super.onResume()
        if (isReturningFromCamera) {
            isReturningFromCamera = false
            return
        }
        resetObserver()
        getQrCodeLinkFromAPI()
    }

    override fun onPause() {
        super.onPause()
        sareeCatViewmodel.cancelQrScanPhotoFetchApiJob()
    }

    private fun showPoseGuideDialog(){
        val showPoseGuideDialog = ShowPoseGuideDialog(vastraFor)
        showPoseGuideDialog.show(supportFragmentManager, "ShowPoseGuideDialog")
    }

    private fun getQrCodeLinkFromAPI(){
        LoaderManager.show(this,findViewById(android.R.id.content),false)
        binding.imgQrcode.isVisible = true
        binding.progressLoader.isVisible = false
        binding.txtProgressStatus.text = getString(R.string.scan_amp_send_photo)
        sareeCatViewmodel.getQrCodeLinkAPI(this)
        sareeCatViewmodel.qrCodeLinkData.observe(this) { qrCodeLinkData ->
            LoaderManager.remove(this)
            if(qrCodeLinkData!=null){
                val qrCodeOfUploadImage = ViewControll.generateQRCodeFromText(qrCodeLinkData.url)
                if(qrCodeOfUploadImage!=null){
                    binding.imgQrcode.setImageBitmap(qrCodeOfUploadImage)
                    val linkSplits = qrCodeLinkData.url.split("/")
                    val securityCode = linkSplits.get(linkSplits.size-1)
                    checkUserUploadImageStatus(securityCode)
                }
            }
        }
        sareeCatViewmodel.error.observe(this){errorMsg->
            LoaderManager.remove(this)
            if(errorMsg!=null){
                ViewControll.showMessage(this,errorMsg)
                resetObserver()
                finish()
            }
        }
    }

    private fun resetObserver(){
        sareeCatViewmodel.resetQrCodeLinkData()
        sareeCatViewmodel.error.removeObservers(this)
        sareeCatViewmodel.qrCodeLinkData.removeObservers(this)
        sareeCatViewmodel.uploadUserImageData.removeObservers(this)
        sareeCatViewmodel.userOpenQrCodeLink.removeObservers(this)
    }

    private fun resetUploadImageObserver(){
        sareeCatViewmodel.resetUploadImageData()
        sareeCatViewmodel.error.removeObservers(this)
        sareeCatViewmodel.uploadUserImageData.removeObservers(this)
        sareeCatViewmodel.userOpenQrCodeLink.removeObservers(this)
    }

    private fun checkPermissionsAndStartCamera() {
        val cameraPermission = Manifest.permission.CAMERA
        val storagePermission = Manifest.permission.WRITE_EXTERNAL_STORAGE // Needed for Android 9 or below
        val granted = PackageManager.PERMISSION_GRANTED

        val permissionsNeeded = mutableListOf<String>()

        // Check Camera permission
        if (ContextCompat.checkSelfPermission(this, cameraPermission) != granted) {
            permissionsNeeded.add(cameraPermission)
        }

        // Check Storage permission for Android 9 or below
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(this, storagePermission) != granted) {
            permissionsNeeded.add(storagePermission)
        }

        // Request permissions if needed
        if (permissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsNeeded.toTypedArray(), 107)
        }else{
            dispatchTakePictureIntent()  // Start CameraX if all required permissions are granted
//            //for Android14 kiosk
//            openBestAvailableCamera(this)
        }
    }

    private fun dispatchTakePictureIntent() {
        try {
            sareeCatViewmodel.cancelQrScanPhotoFetchApiJob()
            val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)

            // Force front camera (best-effort, not guaranteed)
            takePictureIntent.putExtra("android.intent.extras.CAMERA_FACING", 1)
            takePictureIntent.putExtra("android.intent.extras.LENS_FACING_FRONT", 1)
            takePictureIntent.putExtra("android.intent.extras.USE_FRONT_CAMERA", true)

            // Create output file in DCIM/Camera for full-resolution image
          /*  val photoFile = createImageFile() ?: return
            val photoURI: Uri = FileProvider.getUriForFile(
                this,
                "${packageName}.provider",
                photoFile
            )*/
        /*    val photoURI =  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.TITLE, "IMG_${System.currentTimeMillis()}")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/Camera")
                }
                contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            }else{
                val photoFile = createImageFile() ?: return
                FileProvider.getUriForFile(
                    this,
                    "${packageName}.provider",
                    photoFile
                )
            }*/

            val photoFile = createImageFile() ?: return
            val photoURI = FileProvider.getUriForFile(
                this,
                "${packageName}.provider",
                photoFile
            )
            if(photoURI==null){
                return
            }

            currentPhotoUri = photoURI
            // Grant URI permission to camera app
            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoURI)
            takePictureIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            grantUriPermission(
                takePictureIntent.resolveActivity(packageManager)?.packageName ?: "",
                photoURI,
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            isReturningFromCamera = true
            takePictureLauncher.launch(takePictureIntent)

        }catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No camera app available", Toast.LENGTH_SHORT).show()
        }catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun openBestAvailableCamera(activity: Activity) {
        sareeCatViewmodel.cancelQrScanPhotoFetchApiJob()
        val pm = activity.packageManager

        // Step 0: Any camera at all?
//        if (!pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
//            ViewControll.showMessage(activity, "No usable camera found on this device")
//            return
//        }

        // Step 1: Prepare output file
        val photoFile = createImageFile() ?: return
        val photoURI = FileProvider.getUriForFile(
            this,
            "${packageName}.provider",
            photoFile
        )
        if(photoURI==null){
            return
        }

        currentPhotoUri = photoURI

        // Step 3: Fallback → BACK camera
        if (pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            val backIntent = createCameraIntent(photoURI, false)
            if (backIntent.resolveActivity(pm) != null) {
                takePictureLauncher.launch(backIntent)
                return
            }
        }

        // Step 2: Try FRONT camera
        if (pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT)) {
            val frontIntent = createCameraIntent(photoURI, true)
            if (frontIntent.resolveActivity(pm) != null) {
                takePictureLauncher.launch(frontIntent)
                return
            }
        }

        // Step 4: Nothing worked
        ViewControll.showMessage(activity, "No usable camera found on this device")
    }

    private fun createCameraIntent(uri: Uri, front: Boolean): Intent {
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {

            if (front) {
                putExtra("android.intent.extras.CAMERA_FACING", 1)
                putExtra("android.intent.extras.LENS_FACING_FRONT", 1)
                putExtra("android.intent.extras.USE_FRONT_CAMERA", true)
            } else {
                putExtra("android.intent.extras.CAMERA_FACING", 0)
                putExtra("android.intent.extras.LENS_FACING_FRONT", 0)
                putExtra("android.intent.extras.USE_FRONT_CAMERA", false)
            }

            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            grantUriPermission(
                resolveActivity(packageManager)?.packageName ?: "",
                uri,
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
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

    // Initialize ActivityResultLauncher
    private val takePictureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                LoaderManager.show(this@CapturePhotoActivity, findViewById(android.R.id.content), true)
                LoaderManager.setMessage("Processing Photo...")
                lifecycleScope.launch {
                    yield()
                    val rotationFixedUri = withContext(Dispatchers.IO) {
                        currentPhotoUri?.let {
                            fixImageRotationFromUri(this@CapturePhotoActivity, it)
                        }
                    }
                    LoaderManager.remove(this@CapturePhotoActivity)
                    startUCropImage(rotationFixedUri ?: currentPhotoUri!!)
                }

            } else {
                safeDeleteFile(currentPhotoUri.toString())
                currentPhotoUri = null
                Log.d("CameraCapture", "User cancelled capture")
            }
        }

    private fun safeDeleteFile(pathUri: String?) {
        if (pathUri.isNullOrEmpty()) return
        try {
            val uri = Uri.parse(pathUri)
            when (uri.scheme) {
                "content" -> contentResolver.delete(uri, null, null)
                "file" -> {
                    val file = File(uri.path ?: return)
                    if (file.exists()) file.delete()
                }
                else -> { // handle plain file paths (no scheme)
                    val file = File(pathUri)
                    if (file.exists()) file.delete()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
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
            setCompressionQuality(90)
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

    fun fixImageRotationSmart(imagePath: String): String {
        try {
            val exif = ExifInterface(imagePath)

            // Read orientation tag
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )

            // Map EXIF orientation to degrees
            val rotationDegrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }

            // Detect if mirrored (some front cameras set this tag)
            val isMirrored = orientation == ExifInterface.ORIENTATION_FLIP_HORIZONTAL ||
                    orientation == ExifInterface.ORIENTATION_TRANSPOSE ||
                    orientation == ExifInterface.ORIENTATION_TRANSVERSE ||
                    orientation == ExifInterface.ORIENTATION_FLIP_VERTICAL

            Log.d("RotationFix", "rotation=$rotationDegrees, mirrored=$isMirrored")

            // ✅ Case 1: No rotation/mirror → nothing to do
            if (rotationDegrees == 0 && !isMirrored) return imagePath

            // ✅ Case 2: Try lossless EXIF correction first
            try {
                exif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
                exif.saveAttributes()
                Log.d("RotationFix", "Lossless EXIF fix applied.")
                return imagePath
            } catch (exifError: Exception) {
                exifError.printStackTrace()
            }

            // ✅ Case 3: Fallback — physically rotate/mirror pixels
            val bitmap = BitmapFactory.decodeFile(imagePath) ?: return imagePath
            val matrix = Matrix()
            if (rotationDegrees != 0) matrix.postRotate(rotationDegrees.toFloat())
            if (isMirrored) matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)

            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

            // Overwrite original image with rotated pixels (100% quality)
            FileOutputStream(imagePath).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }

            // Reset EXIF orientation to normal
            val newExif = ExifInterface(imagePath)
            newExif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
            newExif.saveAttributes()

            Log.d("RotationFix", "Full rotation applied (bitmap re-encoded).")

            return imagePath
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return imagePath
    }

    fun fixImageRotationFromUri(context: Context, imageUri: Uri): Uri? {
        return try {
            // 1️⃣ Open input stream from URI
            val inputStream = context.contentResolver.openInputStream(imageUri) ?: return imageUri

            // 2️⃣ Copy image into a temp file (to work with ExifInterface)
            val tempFile = File(context.cacheDir, "fixed_${System.currentTimeMillis()}.jpg")
            FileOutputStream(tempFile).use { out -> inputStream.copyTo(out) }
            inputStream.close()

            val exif = ExifInterface(tempFile.absolutePath)

            // 3️⃣ Read orientation tag
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )

            val rotationDegrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }

            //for kiosk
//            val isFrontCamera = true

            //for mobile or tab
            val isFrontCamera = isFrontCameraImage(tempFile.absolutePath)

            Log.d("FixRotation", "rotation=$rotationDegrees, mirror=$isFrontCamera")

            // 4️⃣ If no rotation or mirroring needed → return original temp file
            if (rotationDegrees == 0 && !isFrontCamera) {
                return Uri.fromFile(tempFile)
            }

            // 5️⃣ Decode, rotate, and/or mirror
            val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath)
            val matrix = Matrix()
            if (rotationDegrees != 0) matrix.postRotate(rotationDegrees.toFloat())
            // Fix Mirroring for Front Camera
            if (isFrontCamera) {
                matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
                Log.e("Camera2", "Front Camera detected, fixing mirroring")
            }
            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

            // 6️⃣ Save rotated image (overwrite same temp file)
            FileOutputStream(tempFile).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }

            // 7️⃣ Reset EXIF orientation to "normal"
            val newExif = ExifInterface(tempFile.absolutePath)
            newExif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
            newExif.saveAttributes()

            Uri.fromFile(tempFile)
        } catch (e: Exception) {
            e.printStackTrace()
            imageUri // fallback to original
        }
    }

    private fun fixImageRotation(imagePath: String): String {
        return try {
            val exif = ExifInterface(imagePath)

            // Read EXIF rotation (may be 0 on some devices)
            var rotationDegrees = when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }

            Log.e("Camera2", "Camera Orientation from EXIF: $rotationDegrees")

            // Load Bitmap
            val bitmap = BitmapFactory.decodeFile(imagePath)

            // If EXIF is 0 but image is sideways (width > height), fix rotation
            /*  if (rotationDegrees == 0 && bitmap.width > bitmap.height) {
                  rotationDegrees = -90
                  Log.e("Camera2", "Image is sideways, fixing rotation: $rotationDegrees")
              }*/

            // Create Matrix for transformation
            val matrix = Matrix()
            matrix.postRotate(rotationDegrees.toFloat())

            val isFrontCamera = isFrontCameraImage(imagePath)

            // Fix Mirroring for Front Camera
            if (isFrontCamera) {
                matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
                Log.e("Camera2", "Front Camera detected, fixing mirroring")
            }

            // Rotate the bitmap
            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

            // Save the corrected image
            val correctedFile = File(getExternalFilesDir(null), "corrected_${System.currentTimeMillis()}.jpg")
            FileOutputStream(correctedFile).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
            correctedFile.absolutePath
        } catch (e: Exception) {
            e.printStackTrace()
            imagePath
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

    private fun checkUserUploadImageStatus(token: String) {
        sareeCatViewmodel.startCheckOfUserImageUpload(token)
        sareeCatViewmodel.uploadUserImageData.observe(this) { uploadUserImageData ->
            LoaderManager.remove(this)
            if (uploadUserImageData != null) {
                if (!uploadUserImageData.status) {
                    resetUploadImageObserver()
                    ViewControll.showMessage(
                        this,
                        uploadUserImageData.message.ifBlank { "This QR code expired. Please try again." },
                    )
                    finish()
                    return@observe
                }
                resetUploadImageObserver()
                LoaderManager.show(this, findViewById(android.R.id.content), true)
                LoaderManager.setMessage(getString(R.string.fetching_photo))
                lifecycleScope.launch {
                    val downloadedFile = try {
                        downloadUploadedPhotoToCache(uploadUserImageData.imagePath)
                    } catch (cause: Throwable) {
                        val (title, message) = ApiErrorPresenter.present(cause)
                        LoaderManager.remove(this@CapturePhotoActivity)
                        ViewControll.showMessage(this@CapturePhotoActivity, "$title: $message")
                        return@launch
                    }
                    LoaderManager.remove(this@CapturePhotoActivity)
                    if (downloadedFile == null) {
                        ViewControll.showMessage(
                            this@CapturePhotoActivity,
                            "App error: could not load the uploaded photo. Please try again.",
                        )
                        return@launch
                    }
                    PrefsManager.saveImageId(this@CapturePhotoActivity, uploadUserImageData.garment_id)
                    gotoNextScreen(downloadedFile.absolutePath, AppConstant.ISFROM_SCAN_QR_CODE)
                }
            }
        }
        sareeCatViewmodel.userOpenQrCodeLink.observe(this) { uploadUserImageData ->
            if (uploadUserImageData != null) {
                if (uploadUserImageData.open.equals("yes", true)) {
                    binding.imgQrcode.isVisible = false
                    binding.progressLoader.isVisible = true
                    binding.txtProgressStatus.text = getString(R.string.fetching_photo)
                } else {
                    binding.imgQrcode.isVisible = true
                    binding.progressLoader.isVisible = false
                    binding.txtProgressStatus.text = getString(R.string.scan_amp_send_photo)
                }
            }
        }
    }

    private suspend fun downloadUploadedPhotoToCache(r2Key: String): File? {
        return try {
            val viewModel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
            val presignedGetUrl = viewModel.getTryonPhotoUrlSync(r2Key)
            downloadImageToCacheAsync(this, presignedGetUrl, "qr_upload_${System.currentTimeMillis()}.jpg")
        } catch (cause: ApiException) {
            throw cause
        } catch (cause: IOException) {
            throw ApiException.NetworkError(cause)
        } catch (cause: Exception) {
            throw ApiException.ClientError(cause.message ?: "Could not load the uploaded photo")
        }
    }

    private suspend fun downloadImageToCacheAsync(context: Context, url: String, fileName: String): File? {
        return withContext(Dispatchers.IO) {
            try {
                okhttp3.OkHttpClient().newCall(okhttp3.Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw ApiException.BackendError(
                            code = "PHOTO_DOWNLOAD_HTTP_${response.code}",
                            backendMessage = "Photo download failed with HTTP ${response.code}",
                            httpStatus = response.code,
                        )
                    }
                    val inputStream = response.body?.byteStream()
                        ?: throw ApiException.ClientError("Photo download returned an empty response")
                    inputStream.use { stream ->
                        val bitmap = BitmapFactory.decodeStream(stream)
                            ?: throw ApiException.ClientError("Photo download returned an invalid image")
                        val tempFile = File(context.cacheDir, fileName)
                        FileOutputStream(tempFile).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
                        }
                        tempFile
                    }
                }
            } catch (cause: ApiException) {
                throw cause
            } catch (cause: IOException) {
                throw ApiException.NetworkError(cause)
            }
        }
    }
    private fun gotoProductScanActivity(){
        val intent = Intent(this@CapturePhotoActivity, ProductQrScannerActivity::class.java)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            // ✅ A will finish when B or C signals
            finish()
        }
    }

    private fun gotoNextScreen(capturePhotoFilePath:String,isFrom:String){
        val intent = Intent(this@CapturePhotoActivity, UploadPhotoActivity::class.java)
        intent.putExtra(AppConstant.CAPTURED_PHOTO,capturePhotoFilePath)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        intent.putExtra(AppConstant.IS_FROM,isFrom)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }
}

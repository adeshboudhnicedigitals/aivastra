package aivastra.nice.interactive.activity.camera

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityProductQrScannerBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.util.Log
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.yalantis.ucrop.UCrop
import com.yalantis.ucrop.util.FileUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

class ProductQrScannerActivity : BaseActivity() {

    private var isFrontCamera: Boolean = false
    private lateinit var binding: ActivityProductQrScannerBinding
    private var imageCapture: ImageCapture? = null
    private var vastraFor: String = "women"
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProductQrScannerBinding.inflate(layoutInflater)
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
        // Request Camera Permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
        binding.btnTakePhoto.setOnClickListener {
            takePhoto()
        }
        binding.btnFlipCamera.setOnClickListener {
            toggleCamera()
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera() else
            Toast.makeText(this, "Camera permission denied", Toast.LENGTH_SHORT).show()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val selector =
                if (isFrontCamera) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK

            val preview = Preview.Builder()
                .build()
                .also { it.setSurfaceProvider(binding.previewView.surfaceProvider) }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .build()

            val cameraSelector = CameraSelector.Builder()
                .requireLensFacing(selector)
                .build()

            val analyzer = ImageAnalysis.Builder()
                .build()
                .also {
                    it.setAnalyzer(ContextCompat.getMainExecutor(this), { imageProxy ->

                    })
                }

            try {
                cameraProvider.unbindAll()
                val camera = cameraProvider.bindToLifecycle(
                    this, cameraSelector, preview, imageCapture, analyzer
                )
                // Set zoom ratio to normal
                camera.cameraControl.setZoomRatio(1f)
            } catch (e: Exception) {
                Log.e("CameraX", "Camera binding failed", e)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun toggleCamera() {
        isFrontCamera = !isFrontCamera
        startCamera()
    }


    private fun takePhoto() {
        val imageCapture = imageCapture ?: return

        val photoFile = File(
            externalMediaDirs.first(),
            SimpleDateFormat(
                "yyyy-MM-dd-HH-mm-ss-SSS",
                Locale.US
            ).format(System.currentTimeMillis()) + ".jpg"
        )

        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    LoaderManager.show(this@ProductQrScannerActivity,findViewById(android.R.id.content),false)
                    fixCapturedImageRotation(photoFile.absolutePath)
                }

                override fun onError(exception: ImageCaptureException) {
                    Toast.makeText(
                        this@ProductQrScannerActivity,
                        "Error: ${exception.message}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        )
    }

    private fun fixCapturedImageRotation(currentPhotoPath: String) {
        val rotationFixedFilePath = fixImageRotation(currentPhotoPath)
        val photoURI: Uri = FileProvider.getUriForFile(
            this,
            "${packageName}.provider",
            File(rotationFixedFilePath)
        )
        LoaderManager.remove(this)
        startUCropImage(photoURI)
    }

    private fun setCapturedFinalImage(photoFile: File) {
        gotoNextScreen(photoFile.absolutePath,AppConstant.ISFROM_CAMERA_PHOTO)
    }

    private fun gotoNextScreen(capturePhotoFilePath:String,isFrom:String){
        val intent = Intent(this@ProductQrScannerActivity, UploadPhotoActivity::class.java)
        intent.putExtra(AppConstant.CAPTURED_PHOTO,capturePhotoFilePath)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        intent.putExtra(AppConstant.IS_FROM,isFrom)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun fixImageRotation(imagePath: String): String {
        return try {
            val exif = ExifInterface(imagePath)

            // Read EXIF rotation (may be 0 on some devices)
            var rotationDegrees = when (exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )) {
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
            val rotatedBitmap =
                Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)

            // Save the corrected image
            val correctedFile =
                File(getExternalFilesDir(null), "corrected_${System.currentTimeMillis()}.jpg")
            FileOutputStream(correctedFile).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
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
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_UNDEFINED
            )

            // Check camera lens information (some devices include it)
            val lensMake = exif.getAttribute(ExifInterface.TAG_MAKE) ?: ""
            val lensModel = exif.getAttribute(ExifInterface.TAG_MODEL) ?: ""

            Log.e(
                "Camera2",
                "Orientation: $orientation, LensMake: $lensMake, LensModel: $lensModel"
            )

            // If orientation is 270 or 90, likely a front camera (some devices)
            return orientation == ExifInterface.ORIENTATION_ROTATE_270 || orientation == ExifInterface.ORIENTATION_ROTATE_90

        } catch (e: Exception) {
            e.printStackTrace()
            false // Assume back camera if unknown
        }
    }

    private fun isValidUrl(url: String): Boolean {
        return try {
            val uri = Uri.parse(url)
            uri.scheme?.startsWith("http") == true && uri.host != null
        } catch (e: Exception) {
            false
        }
    }

    val uCropActivityResult =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result: ActivityResult ->
            if (result.data != null && result.resultCode == RESULT_OK) {
                val uri = UCrop.getOutput(result.data!!)
                if (uri != null) {
                    val selectedImageFile = File(FileUtils.getPath(this, uri))
                    setCapturedFinalImage(selectedImageFile)
                }
            }
        }

    private fun startUCropImage(uri: Uri) {
        try {
            val uniqueFileName = "croppedImage_${UUID.randomUUID()}.png"
            val destinationUri = Uri.fromFile(File(this.cacheDir, uniqueFileName))
            val intent = UCrop.of(uri, destinationUri)
                .withMaxResultSize(1080, 1920) // Increase resolution
                .withOptions(getUCropOptions()) // Set high-quality options
                .getIntent(this)
            uCropActivityResult.launch(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getUCropOptions(): UCrop.Options {
        return UCrop.Options().apply {
            setCompressionQuality(100) // Max quality
            setCompressionFormat(Bitmap.CompressFormat.PNG) // Avoid quality loss
        }
    }

    private fun getFileFromUrl(imageUrl: String) {
        CoroutineScope(Dispatchers.Main).launch {
            val file = downloadImageToCacheAsync(this@ProductQrScannerActivity, imageUrl)
            file?.let {
                setCapturedFinalImage(file)
            }
        }
    }

    suspend fun downloadImageToCacheAsync(
        context: Context,
        url: String,
        fileName: String = "temp_image.jpg"
    ): File? {
        return withContext(Dispatchers.IO) {
            try {
                val client = OkHttpClient()
                val request = Request.Builder().url(url).build()
                val response = client.newCall(request).execute()

                if (!response.isSuccessful) return@withContext null

                val inputStream = response.body?.byteStream() ?: return@withContext null
                val bitmap = BitmapFactory.decodeStream(inputStream)

                val tempFile = File(context.cacheDir, fileName)
                FileOutputStream(tempFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
                }
                tempFile
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }
    }

}







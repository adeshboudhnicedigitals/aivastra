package aivastra.nice.aivastraadmin.fragment

import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.activity.DashBoardActivity
import aivastra.nice.aivastraadmin.activity.LoginActivity
import aivastra.nice.aivastraadmin.activity.ProfileActivity
import android.os.Bundle
import androidx.fragment.app.Fragment
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import aivastra.nice.aivastraadmin.databinding.FragmentUploadVastraBinding
import aivastra.nice.aivastraadmin.dialog.ShowErrorAlertDialog
import aivastra.nice.aivastraadmin.dialog.UploadPhotoDialog
import aivastra.nice.aivastraadmin.utils.ViewControll
import aivastra.nice.aivastraadmin.viewmodels.MerchantCatalogSubcategory
import aivastra.nice.aivastraadmin.viewmodels.ProductUploadViewModel
import aivastra.nice.aivastraadmin.viewmodels.SareeStyle
import aivastra.nice.interactive.Loader.LoaderManager
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
import android.provider.MediaStore
import android.util.Log
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatActivity.RESULT_OK
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.yalantis.ucrop.UCrop
import com.yalantis.ucrop.util.FileUtils
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.UUID


class UploadVastraFragment : Fragment(), View.OnClickListener {

    private lateinit var binding: FragmentUploadVastraBinding
    private lateinit var productUploadViewmodel: ProductUploadViewModel
    private var lastGeneratedResultUrl: String = ""
    private var selectedSubcategoryId: String? = null
    private var selectedStyleId: String? = null
    private var currentPhotoUri:Uri? = null

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = FragmentUploadVastraBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initView()
    }

    private fun initView() {
        productUploadViewmodel = ViewModelProvider(this).get(ProductUploadViewModel::class.java)
        binding.btnUploadPhoto.setOnClickListener(this)
        binding.btnTakePhoto.setOnClickListener(this)
        binding.imgProfile.setOnClickListener(this)
        binding.btnTakePhoto.setTextColor(ContextCompat.getColor(requireActivity(), R.color.white))
        binding.btnUploadPhoto.setTextColor(ContextCompat.getColor(requireActivity(), R.color.white))
        binding.llSamplePhoto.post {
            val h = binding.llSamplePhoto.height
            val params = binding.llTitle.layoutParams
            params.height = h
            binding.llTitle.layoutParams = params
        }
        getSubcategoryData()
        getSareeStyleData()
    }

    private fun checkPermissionsAndStartCamera() {
        val cameraPermission = Manifest.permission.CAMERA
        val storagePermission = Manifest.permission.WRITE_EXTERNAL_STORAGE // Needed for Android 9 or below
        val granted = PackageManager.PERMISSION_GRANTED

        val permissionsNeeded = mutableListOf<String>()

        // Check Camera permission
        if (ContextCompat.checkSelfPermission(requireActivity(), cameraPermission) != granted) {
            permissionsNeeded.add(cameraPermission)
        }

        // Check Storage permission for Android 9 or below
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(requireActivity(), storagePermission) != granted) {
            permissionsNeeded.add(storagePermission)
        }

        // Request permissions if needed
        if (permissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(requireActivity(), permissionsNeeded.toTypedArray(), 107)
        } else {
            dispatchTakePictureIntent()  // Start CameraX if all required permissions are granted
        }
    }

    private fun dispatchTakePictureIntent() {
        try {
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
            val photoURI =  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.TITLE, "IMG_${System.currentTimeMillis()}")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/Camera")
                }
                requireActivity().contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            }else{
                val photoFile = createImageFile() ?: return
                FileProvider.getUriForFile(
                    requireActivity(),
                    "${requireActivity().packageName}.provider",
                    photoFile
                )
            }

            if(photoURI==null){
                return
            }

            currentPhotoUri = photoURI
            // Grant URI permission to camera app
            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoURI)
            takePictureIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            requireActivity().grantUriPermission(
                takePictureIntent.resolveActivity(requireActivity().packageManager)?.packageName ?: "",
                photoURI,
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            takePictureLauncher.launch(takePictureIntent)

        }catch (e: ActivityNotFoundException) {
            Toast.makeText(requireActivity(), "No camera app available", Toast.LENGTH_SHORT).show()
        }catch (e: Exception) {
            e.printStackTrace()
        }
    }


    @Throws(IOException::class)
    private fun createImageFile(): File? {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss").format(Date())

        val dcimDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
        val cameraDir = File(dcimDir, "Camera")
        if (!cameraDir.exists()) cameraDir.mkdirs()
        return File.createTempFile("IMG_${timeStamp}_", ".jpg", cameraDir)
    }

    // Initialize ActivityResultLauncher
    private val takePictureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {result ->
            if (result.resultCode == Activity.RESULT_OK) {
                currentPhotoUri?.let { path ->
                    val rotationFixedUri = fixImageRotationFromUri(requireActivity(),path)
                    if (rotationFixedUri != null) {
                        startUCropImage(rotationFixedUri)
                    }else{
                        startUCropImage(path)
                    }
                }
            }else {
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
                "content" -> requireActivity().contentResolver.delete(uri, null, null)
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
            val destinationUri = Uri.fromFile(File(requireActivity().cacheDir, uniqueFileName))

            val intent = UCrop.of(uri, destinationUri)
                .useSourceImageAspectRatio()
                .withOptions(getUCropOptions())
                .getIntent(requireActivity())

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
                        val file = getFileFromUriSafe(requireActivity(),uri)
                        if(file!=null){
                            gotoNextScreen(file.absolutePath)
                        }else{
                            ViewControll.showMessage(requireActivity(), "Image processing failed. Please try again.")
                        }
                    } else {
                        ViewControll.showMessage(requireActivity(), "Capture failed. Please try again.")
                    }
                } else if (result.resultCode == UCrop.RESULT_ERROR) {
                    val cropError = UCrop.getError(result.data!!)
                    ViewControll.showMessage(requireActivity(), "Crop failed: ${cropError?.message}")
                }
            } catch (e: Exception) {
                e.printStackTrace()
                ViewControll.showMessage(requireActivity(), "Capture failed. Please try again.")
            }
        }

    // Initialize the image picker launcher
    val selectImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            startUCropImage(it) // Handle the selected image URI
        }
    }

    private fun getFileFromUriSafe(context: Context, uri: Uri): File? {
        // 1️⃣ Try legacy FileUtils path (may fail on Android 11+)
        try {
            val path = FileUtils.getPath(context, uri)
            if (!path.isNullOrBlank()) {
                val file = File(path)
                if (file.exists() && file.length() > 0) {
                    return file
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // 2️⃣ Fallback – SAFEST METHOD
        return copyUriToCacheFileSafe(context, uri)
    }

    private fun copyUriToCacheFileSafe(context: Context, uri: Uri): File? {
        return try {
            val inputStream = context.contentResolver.openInputStream(uri) ?: return null

            val file = File(context.cacheDir, "final_${System.currentTimeMillis()}.jpg")

            FileOutputStream(file).use { output ->
                inputStream.use { input ->
                    input.copyTo(output)
                }
            }

            if (file.exists() && file.length() > 0) file else null
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
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
            FileOutputStream(tempFile).use {out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
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

    private fun isFrontCameraImage(imagePath: String): Boolean {
        return try {
            val exif = ExifInterface(imagePath)

            // Some devices store front camera as orientation 270 or 90
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED)

            // Check camera lens information (some devices include it)
            val lensMake = exif.getAttribute(ExifInterface.TAG_MAKE) ?: ""
            val lensModel = exif.getAttribute(ExifInterface.TAG_MODEL) ?: ""

            Log.e("Camera2", "Orientation: $orientation, LensMake: $lensMake, LensModel: $lensModel")

            if(isFrontCameraImageForSamsung(imagePath)){
                if(orientation == ExifInterface.ORIENTATION_ROTATE_270 ||
                    orientation == ExifInterface.ORIENTATION_ROTATE_90 ){
                    return true
                }else{
                    return false
                }
            }else{
//                // If orientation is 270 or 90, likely a front camera (some devices)
//                return orientation == ExifInterface.ORIENTATION_ROTATE_270 || orientation == ExifInterface.ORIENTATION_ROTATE_90
//                return false
               return false
            }
        }catch (e: Exception) {
            e.printStackTrace()
            false // Assume back camera if unknown
        }
    }

    fun isFrontCameraImageForSamsung(imagePath: String): Boolean {
        val exif = ExifInterface(imagePath)

        val orientation = exif.getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL
        )

        return orientation == ExifInterface.ORIENTATION_FLIP_HORIZONTAL ||
                orientation == ExifInterface.ORIENTATION_TRANSPOSE ||
                orientation == ExifInterface.ORIENTATION_TRANSVERSE
    }

    private fun gotoNextScreen(capturePhotoFilePath: String) {
        val subcategoryId = selectedSubcategoryId
        if (subcategoryId == null) {
            ViewControll.showMessage(
                requireActivity(),
                "Please select a product type before uploading"
            )
            return
        }
        val uploadPhotoDialog = UploadPhotoDialog(capturePhotoFilePath, subcategoryId, selectedStyleId) { resultUrl ->
            lastGeneratedResultUrl = resultUrl
            binding.llAddProduct.isVisible = true
            binding.llUploadProduct.isVisible = false
            resetSelectCatSKUDetails()
            initViewAddProduct(resultUrl)
        }
        uploadPhotoDialog.show(childFragmentManager, "UploadPhotoDialog")
    }

    private fun initViewAddProduct(resultUrl: String) {
        try{
            Glide.with(requireActivity())
                .load(resultUrl)
                .placeholder(ViewControll.setLoaderDrawble(requireActivity()))
                .into(binding.imgTryonResult)
        }catch (e:Exception){
            e.printStackTrace()
        }
        binding.btnCancel.setOnClickListener(this)
        binding.btnUpload.setOnClickListener(this)
        binding.btnUpload.setTextColor(ContextCompat.getColor(requireActivity(), R.color.white))
        binding.btnCancel.setTextColor(ContextCompat.getColor(requireActivity(), R.color.white))
    }

    private fun checkValidation(): Boolean {
        if(binding.etSkuNo.text.trim().isEmpty()){
            ViewControll.showMessage(requireActivity(),"Please add SKU No")
            return false
        }else if(binding.etPrice.text.trim().isEmpty()){
            ViewControll.showMessage(requireActivity(),"Please add price")
            return false
        }else if(binding.etOfferPrice.text.trim().isEmpty()){
            ViewControll.showMessage(requireActivity(),"Please add offer price")
            return false
        }else{
            return true
        }
    }

    private fun uploadVastraProductAPI(){
        val skuNo = binding.etSkuNo.text.trim().toString()
        val price = binding.etPrice.text.trim().toString().toIntOrNull() ?: 0
        val offerPrice = binding.etOfferPrice.text.trim().toString().toIntOrNull() ?: 0
        LoaderManager.show(requireActivity(),requireActivity().findViewById(android.R.id.content),true)
        LoaderManager.setMessage("Adding Product...")
        productUploadViewmodel.finalizeProduct(skuNo, price, offerPrice) { success, errorMsg ->
            LoaderManager.remove(requireActivity())
            if(success){
                ViewControll.showMessage(requireActivity(),"Product added successfully")
                binding.llUploadProduct.isVisible = true
                binding.llAddProduct.isVisible = false
                (activity as? DashBoardActivity)?.navigateToProductFrag()
            } else {
                ViewControll.showMessage(requireActivity(),errorMsg)
            }
        }
    }

    private fun getSubcategoryData(){
        productUploadViewmodel.fetchSubcategories("women")
        productUploadViewmodel.subcategories.observe(viewLifecycleOwner){subcategoryList->
            if(subcategoryList!=null && subcategoryList.isNotEmpty()){
                setSubcategorySpinner(subcategoryList)
            }
        }
        productUploadViewmodel.error.observe(viewLifecycleOwner){errorMsg->
            if(errorMsg!=null){
                ViewControll.showSnackErrorMsg(requireActivity(),errorMsg)
            }
        }
    }

    private fun getSareeStyleData(){
        productUploadViewmodel.fetchSareeStyles()
        productUploadViewmodel.sareeStyles.observe(viewLifecycleOwner){styleList->
            if(styleList!=null){
                setSareeStyleCards(styleList)
            }
        }
    }

    // No styles configured yet (admin hasn't added any) is a valid state — the
    // merchant app keeps working, generate() just omits sareeStyleId and the
    // backend falls back to the garment type's own mannequin workflow.
    private fun setSareeStyleCards(styleList: List<SareeStyle>) {
        binding.llSareeStyles.removeAllViews()
        if (styleList.size <= 1) {
            binding.hsvSareeStyles.isVisible = false
            selectedStyleId = styleList.firstOrNull()?.id
            return
        }
        binding.hsvSareeStyles.isVisible = true
        val inflater = LayoutInflater.from(requireActivity())
        val cardViews = mutableListOf<View>()
        styleList.forEachIndexed { index, style ->
            val card = inflater.inflate(R.layout.item_saree_style, binding.llSareeStyles, false)
            val img = card.findViewById<ImageView>(R.id.img_style_preview)
            val label = card.findViewById<TextView>(R.id.tv_style_label)
            label.text = style.label
            if (style.previewUrl != null) {
                Glide.with(requireActivity()).load(style.previewUrl).into(img)
            }
            card.setOnClickListener {
                selectedStyleId = style.id
                cardViews.forEach { current -> current.setBackgroundResource(R.drawable.bg_style_card_unselected) }
                card.setBackgroundResource(R.drawable.bg_style_card_selected)
            }
            if (index == 0) {
                selectedStyleId = style.id
                card.setBackgroundResource(R.drawable.bg_style_card_selected)
            }
            (card.layoutParams as? ViewGroup.MarginLayoutParams)?.marginEnd =
                resources.getDimensionPixelSize(R.dimen._8sdp)
            cardViews.add(card)
            binding.llSareeStyles.addView(card)
        }
    }

    private fun setSubcategorySpinner(subcategoryList: List<MerchantCatalogSubcategory>) {
        val nameList = subcategoryList.map { it.name }
        val adapter = ArrayAdapter(requireActivity(), R.layout.item_spinner_text, nameList)
        binding.materialSpinnerPalluType.setAdapter(adapter)
        binding.materialSpinnerPalluType.setOnItemClickListener { _, _, position, _ ->
            selectedSubcategoryId = subcategoryList[position].id
        }
        binding.materialSpinnerPalluType.setDropDownBackgroundDrawable(
            ContextCompat.getDrawable(requireActivity(), R.drawable.bg_dropdown_white)
        )

        // Auto-select the first item so selectedSubcategoryId is never null — the spinner
        // shows the first item visually but doesn't fire setOnItemClickListener without this.
        if (subcategoryList.isNotEmpty()) {
            selectedSubcategoryId = subcategoryList[0].id
            binding.materialSpinnerPalluType.setText(subcategoryList[0].name, false)
        }

        // Only one saree type today means there's nothing to actually choose between —
        // disable the picker rather than make the merchant tap a dropdown with one entry.
        // Re-enables itself automatically once a second subcategory exists.
        binding.materialSpinnerPalluType.isEnabled = subcategoryList.size > 1
    }

    fun handleBack(){
        if(binding.llAddProduct.isVisible == true){
            showCancleUploadAlertDialog(lastGeneratedResultUrl)
        }else{
            (activity as? DashBoardActivity)?.finish()
        }
    }

    private fun showCancleUploadAlertDialog(tryOnResultUrl:String){
        val showErrorAlertDialog = ShowErrorAlertDialog(
            ShowErrorAlertDialog.ImageSourceType.FromUrl(tryOnResultUrl),
            getString(R.string.discard_upload),
            getString(R.string.discard_upload_alert),
            getString(R.string.stay),
            getString(R.string.discard)){

            binding.llAddProduct.isVisible = false
            binding.llUploadProduct.isVisible = true

        }
        showErrorAlertDialog.show(childFragmentManager, "ShowErrorAlertDialog")
    }

    private fun resetSelectCatSKUDetails(){
        binding.etSkuNo.text.clear()
        binding.etPrice.text.clear()
        binding.etOfferPrice.text.clear()
    }


    private fun isSubcategorySelected(): Boolean {
        if(selectedSubcategoryId==null){
            ViewControll.showMessage(requireActivity(),"Please select a product type before upload/capture photo")
            return false
        }
        return true
    }

    companion object {
        @JvmStatic
        fun newInstance() = UploadVastraFragment()
    }

    override fun onClick(v: View?) {
        val id = v?.id
        if (id == R.id.btn_upload_photo) {
            if(isSubcategorySelected()){
                selectImageLauncher.launch("image/*")
            }
        }
        if (id == R.id.btn_take_photo) {
            if(isSubcategorySelected()){
                checkPermissionsAndStartCamera()
            }
        }
        if(id==R.id.btn_cancel){
            showCancleUploadAlertDialog(lastGeneratedResultUrl)
        }
        if(id==R.id.btn_upload){
            if(checkValidation()){
                uploadVastraProductAPI()
            }
        }
        if(id==R.id.img_profile){
            val intent = Intent(requireActivity(), ProfileActivity::class.java)
            startActivity(intent)
            requireActivity().overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
        }
    }
}

package aivastra.nice.interactive.activity.camera

import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.activity.vastra.VastraTryOnActivity
import aivastra.nice.interactive.databinding.ActivityUploadPhotoBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.request.RequestOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

class UploadPhotoActivity : BaseActivity(), View.OnClickListener {

    private lateinit var binding:ActivityUploadPhotoBinding
    private var capturedPhotoPath:String? = null
    private var uploadedImageUrl:String? = null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var vastraFor:String = "women"
    private var isFrom:String = ""
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUploadPhotoBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        capturedPhotoPath = intent?.extras?.getString(AppConstant.CAPTURED_PHOTO).toString()
        isFrom = intent?.extras?.getString(AppConstant.IS_FROM).toString()
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
        ViewControll.setCompanyLogo(this,binding.llToolbar.appLogo)
        if(isFrom.equals(AppConstant.ISFROM_CAMERA_PHOTO)) {
            capturedPhotoPath?.let { setCapturedOrScanImage(it,true) }
        }else{
           /* showUploadPhotoLoader()
            capturedPhotoPath?.let { getFileFromUrl(it) }*/
            binding.llProceedRetake.isVisible = true
            capturedPhotoPath?.let { updateUploadedPhoto(it) }
        }
        binding.llProceed.setOnClickListener(this)
        binding.llRetakePhoto.setOnClickListener(this)
        binding.llToolbar.imgBack.setOnClickListener(this)
    }

    private fun setCapturedOrScanImage(capturedImagePath:String,isLoaderShow: Boolean){
        capturedPhotoPath = capturedImagePath
        try{
            Glide.with(this).asBitmap().load(File(capturedImagePath))
                .apply(RequestOptions.diskCacheStrategyOf(DiskCacheStrategy.NONE))
                .skipMemoryCache(true)
                .into(binding.capturedImage)
        }catch (e:Exception){
            e.printStackTrace()
        }
        uploadCapturedPhoto(isLoaderShow)
    }

    private fun uploadCapturedPhoto(isLoaderShow:Boolean){
        if(isLoaderShow){
            showUploadPhotoLoader()
        }
        sareeCatViewmodel.uploadCaptureImageAPI(this, File(capturedPhotoPath))
        sareeCatViewmodel.uploadUserImageData.observe(this) { uploadUserImageData ->
            LoaderManager.remove(this)
            if(uploadUserImageData!=null){
                resetObserver()
                binding.llProceedRetake.isVisible = true
                PrefsManager.saveImageId(this,uploadUserImageData.id)
                capturedPhotoPath?.let { updateUploadedPhotoFromFile(it) }
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

    private fun showUploadPhotoLoader(){
        LoaderManager.show(this,findViewById(android.R.id.content),true)
        LoaderManager.setMessage(getString(R.string.uploading_your_photo))
    }

    private fun updateUploadedPhoto(imagePath:String){
        try{
            uploadedImageUrl = imagePath
            Glide.with(this).asBitmap().load(imagePath)
                .apply(RequestOptions.diskCacheStrategyOf(DiskCacheStrategy.NONE))
                .skipMemoryCache(true)
                .placeholder(ViewControll.setLoaderDrawble(this))
                .into(binding.capturedImage)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    private fun updateUploadedPhotoFromFile(imagePath:String){
        try{
            uploadedImageUrl = imagePath
            Glide.with(this).asBitmap().load(File(imagePath))
                .apply(RequestOptions.diskCacheStrategyOf(DiskCacheStrategy.NONE))
                .skipMemoryCache(true)
                .placeholder(ViewControll.setLoaderDrawble(this))
                .into(binding.capturedImage)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    private fun resetObserver(){
        sareeCatViewmodel.resetUploadImageData()
        sareeCatViewmodel.error.removeObservers(this)
        sareeCatViewmodel.uploadUserImageData.removeObservers(this)
    }

    suspend fun downloadImageToCacheAsync(context: Context, url: String, fileName: String = "temp_image.jpg"): File? {
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

    private fun getFileFromUrl(imageUrl:String){
        CoroutineScope(Dispatchers.Main).launch {
            val file = downloadImageToCacheAsync(this@UploadPhotoActivity, imageUrl)
            file?.let {
                setCapturedOrScanImage(it.absolutePath,false)
            }
        }
    }

    override fun onClick(v: View?) {
        val id = v?.id
        if(id==R.id.ll_proceed){
            uploadedImageUrl?.let { PrefsManager.saveCapturedImage(this, it) }
            val intent = Intent(this@UploadPhotoActivity, VastraTryOnActivity::class.java)
            intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubCategory)
            intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
            startActivity(intent)
            overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
        }
        if(id==R.id.ll_retake_photo){
            finish()
        }
        if(id==R.id.img_back){
            onBackPressedDispatcher.onBackPressed()
        }
    }
}
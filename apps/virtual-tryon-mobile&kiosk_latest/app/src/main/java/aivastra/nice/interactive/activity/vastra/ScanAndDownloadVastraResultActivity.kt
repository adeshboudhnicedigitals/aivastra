package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.HomeDressesForActivity
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.activity.launch.SplashScreenActivity
import aivastra.nice.interactive.databinding.ActivityScanAndDownloadVastraResultBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.UsetTryOnResultDataModel
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.graphics.Bitmap
import android.provider.Settings
import android.view.View
import androidx.core.view.isVisible
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import com.journeyapps.barcodescanner.BarcodeEncoder

class ScanAndDownloadVastraResultActivity : BaseActivity(), View.OnClickListener {

    private lateinit var binding:ActivityScanAndDownloadVastraResultBinding
    private var tryOnResultUrl:String?=null
    private var tryOnResultId:String?=null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var tryOnResultDataList:ArrayList<UsetTryOnResultDataModel.Data> = arrayListOf()
    private var currentPosition = 0
    private var userImageId:String?=null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityScanAndDownloadVastraResultBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        tryOnResultUrl = intent?.extras?.getString(AppConstant.TRY_ON_RESULT).toString()
        tryOnResultId = intent?.extras?.getString(AppConstant.TRY_ON_RESULT_ID).toString()
        userImageId = PrefsManager.getImageID(this)
        ViewControll.setCompanyLogoHorizontal(this,binding.llToolbar.appLogo)
       /* try{
            Glide.with(this@ScanAndDownloadVastraResultActivity)
                .load(tryOnResultUrl)
                .placeholder(ViewControll.setLoaderDrawble(this))
                .into(binding.imageTryonResult)
        }catch(e:Exception){
            e.printStackTrace()
        }
        val tryOnDataResult = UsetTryOnResultDataModel.Data()
        tryOnDataResult.tryon_result_path = tryOnResultUrl?:""
        tryOnResultUrl?.let { setQrCodeScanner(it) }*/
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
        LoaderManager.show(this,findViewById(android.R.id.content),false)
        userImageId?.let { sareeCatViewmodel.fetchUserAllTryOnResultListAPI(it)}
        sareeCatViewmodel.allTryOnResultDataList.observe(this, Observer {dataList->
            LoaderManager.remove(this)
            if(dataList.isNotEmpty()){
                tryOnResultDataList.addAll(dataList)
                dataList.forEachIndexed { index, data ->
                    if(tryOnResultId.equals(data.id)){
                        currentPosition = index
                        updateUIForPosition(index)
                        binding.llMainRoot.isVisible = true
                    }
                }
            }
        })
        setupNavigation()

        val deviceId = PrefsManager.loginUserInfo.user.deviceId
        setQrCodeScannerForDownloadAll("UI preview only")
        binding.btnDeleteAllResults.setOnClickListener(this)
    }

    fun generateQRCode(imageUrl: String): Bitmap? {
        return try {
            val bitMatrix: BitMatrix = MultiFormatWriter().encode(imageUrl, BarcodeFormat.QR_CODE, 650, 650)

            // Remove white padding (find the first and last black pixel)
            val width = bitMatrix.width
            val height = bitMatrix.height
            var minX = width
            var minY = height
            var maxX = 0
            var maxY = 0

            for (x in 0 until width) {
                for (y in 0 until height) {
                    if (bitMatrix[x, y]) {
                        if (x < minX) minX = x
                        if (y < minY) minY = y
                        if (x > maxX) maxX = x
                        if (y > maxY) maxY = y
                    }
                }
            }

            // Create a new BitMatrix without padding
            val newWidth = maxX - minX + 1
            val newHeight = maxY - minY + 1
            val trimmedMatrix = BitMatrix(newWidth, newHeight)
            for (x in 0 until newWidth) {
                for (y in 0 until newHeight) {
                    if (bitMatrix[x + minX, y + minY]) {
                        trimmedMatrix.set(x, y)
                    }
                }
            }

            val barcodeEncoder = BarcodeEncoder()
            barcodeEncoder.createBitmap(trimmedMatrix)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun setQrCodeScanner(tryOnResultUrl:String){
        val qrCodeBitmap = tryOnResultUrl.let { generateQRCode(it) }
        if(qrCodeBitmap!=null){
            binding.imgQrcode.setImageBitmap(qrCodeBitmap)
        }
    }

    private fun setQrCodeScannerForDownloadAll(tryOnResultDownloadAllUrl:String){
        val qrCodeBitmap = tryOnResultDownloadAllUrl.let { generateQRCode(it) }
        if(qrCodeBitmap!=null){
            binding.imgQrcodeDownloadall.setImageBitmap(qrCodeBitmap)
        }
    }

    private fun setupNavigation() {
        binding.btnNext.setOnClickListener {
            if (tryOnResultDataList.isNotEmpty() && currentPosition < tryOnResultDataList.size - 1) {
                currentPosition++
                updateUIForPosition(currentPosition)
            }
        }

        binding.btnPrevious.setOnClickListener {
            if (tryOnResultDataList.isNotEmpty() && currentPosition > 0) {
                currentPosition--
                updateUIForPosition(currentPosition)
            }
        }
    }

    private fun updateUIForPosition(position: Int) {
        try{
            val item = tryOnResultDataList.getOrNull(position)
            if (item != null) {
                // ✅ Set saree image safely
                if (item.tryon_result_path.isNotEmpty()) {
                    Glide.with(this)
                        .load(item.tryon_result_path)
                        .placeholder(ViewControll.setLoaderDrawble(this))
                        .into(binding.imageTryonResult)
                    setQrCodeScanner(item.tryon_result_path)
                }else {
                    binding.imageTryonResult.setImageResource(R.drawable.img_model) // fallback
                }
            }
            if(currentPosition==0 && tryOnResultDataList.size>1){
                binding.btnPrevious.isVisible = false
                binding.btnNext.isVisible = true
            }else if(currentPosition==tryOnResultDataList.size-1 && tryOnResultDataList.size>1){
                binding.btnPrevious.isVisible = true
                binding.btnNext.isVisible = false
            }else if(tryOnResultDataList.size>1){
                binding.btnPrevious.isVisible = true
                binding.btnNext.isVisible = true
            }else{
                binding.btnPrevious.isVisible = false
                binding.btnNext.isVisible = false
            }
        }catch (e:Exception){
            e.printStackTrace()
        }

    }

    private fun showDeleteAllTryOnResultProcessDialog(){
        val showAppAlertDialog = ShowAppAlertDialog(
            ShowAppAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_delete),
            "Reset Try-On Session",
            getString(R.string.delete_tryon_msg),
            getString(R.string.cancel),
            getString(R.string.delete_all)){

            startDeleteProcess()

        }
        showAppAlertDialog.show(supportFragmentManager, "ShowAppAlertDialog")
    }

    private fun startDeleteProcess(){
        LoaderManager.show(this,findViewById(android.R.id.content),false)
        val deviceId = Settings.Secure.getString(this.contentResolver, Settings.Secure.ANDROID_ID)
        sareeCatViewmodel.deleteAllTryOnResultAPI(PrefsManager.getImageID(this),deviceId){status,message->
            LoaderManager.hide(this)
            if(status==true){
                val intent = Intent(this, HomeDressesForActivity::class.java)
                startActivity(intent)
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
                finishAffinity()
            }else{
                ViewControll.showMessage(this,message)
            }
        }
    }

    override fun onClick(v: View?) {
        val id = v?.id
        if(id==R.id.btn_delete_all_results){
           showDeleteAllTryOnResultProcessDialog()
        }
    }
}
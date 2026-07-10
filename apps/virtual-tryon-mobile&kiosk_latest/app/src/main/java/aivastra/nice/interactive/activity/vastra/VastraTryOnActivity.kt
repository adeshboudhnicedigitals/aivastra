package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.R
import android.os.Bundle
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.activity.launch.SplashScreenActivity
import aivastra.nice.interactive.databinding.ActivityVastraTryOnBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.dialog.ShowErrorAlertDialog
import aivastra.nice.interactive.fragment.VastraTryOnProcessingFragment
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressTryOnResultModel
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.MotionEvent
import android.widget.ArrayAdapter
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable
import com.bumptech.glide.Glide
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class VastraTryOnActivity : BaseActivity() {

    private lateinit var binding: ActivityVastraTryOnBinding
    private var selectedVastraSubCategory : DressesTypeDataModel.Data.Subcategory? = null
    private var selectedVastraItem : DressesTypeDataModel.Data.Subcategory.Item? = null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var dX = 0f
    private var dY = 0f
    private var vastraTryOnProcessingDialog: VastraTryOnProcessingFragment? = null
    private lateinit var vastraAdapter: VastraSubCategoryItemAdapter

    private var isHandled = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityVastraTryOnBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.post{
            initView()
        }
    }

    private fun initView() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            selectedVastraSubCategory = intent?.extras?.getSerializable(
                AppConstant.SELECTED_VASTRA_SUBCAT,
                DressesTypeDataModel.Data.Subcategory::class.java)!!
        }else{
            selectedVastraSubCategory= intent.extras?.getSerializable(AppConstant.SELECTED_VASTRA_SUBCAT) as DressesTypeDataModel.Data.Subcategory
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            selectedVastraItem = intent?.extras?.getSerializable(
                AppConstant.SELECTED_VASTRA_ITEM,
                DressesTypeDataModel.Data.Subcategory.Item::class.java)!!
        }else{
            selectedVastraItem= intent.extras?.getSerializable(AppConstant.SELECTED_VASTRA_ITEM) as DressesTypeDataModel.Data.Subcategory.Item
        }
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        ViewControll.setCompanyLogoHorizontal(this,binding.llToolbar.appLogo)
        binding.imageCapturedPhoto.post {
            if(isHttpUrl(PrefsManager.getCapturedImage(this))){
                Glide.with(this@VastraTryOnActivity)
                    .load(PrefsManager.getCapturedImage(this))
                    .placeholder(ViewControll.setLoaderDrawble(this))
                    .into(binding.imageCapturedPhoto)
            }else{
                Glide.with(this@VastraTryOnActivity)
                    .load(File(PrefsManager.getCapturedImage(this)))
                    .placeholder(ViewControll.setLoaderDrawble(this))
                    .into(binding.imageCapturedPhoto)
            }
        }

        setupVastraRecycler()
        binding.recyclerVastraItems.post {
            selectedVastraSubCategory?.let {
                setVastraItemListFromSpinner(it,true)
            }
            setVastracatSpinner()
        }
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
    }

    fun isHttpUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val scheme = Uri.parse(url).scheme
        return scheme == "http" || scheme == "https"
    }

    private fun startSelectedItemTryOnProcess(adapter: VastraSubCategoryItemAdapter){
        if(selectedVastraSubCategory?.items?.size==0){
            selectedVastraItem?.garmentid?.let { startFaceSwapProcess(it) }
            return
        }
        selectedVastraSubCategory?.items?.forEachIndexed { index, item ->
            if(item.garmentid.equals(selectedVastraItem?.garmentid)){
                adapter.selectedItemPosition(index)
                binding.recyclerVastraItems.scrollToPosition(index)
            }
        }
    }

    private fun getSelectedVastraCatList(callback: (ArrayList<String>,ArrayList<DressesTypeDataModel.Data>) -> Unit){
        val subCatList:ArrayList<String> = arrayListOf()
        if(SareeCategoryDataRepository.getDressesTypeData().isEmpty()){
            sareeCatViewmodel.fetchDressesForAPI()
        }else{
            sareeCatViewmodel.getDressesTypeList()
        }
        sareeCatViewmodel.dressesTypeData.observe(this){dressesTypeList->
            if(dressesTypeList!=null && dressesTypeList.isNotEmpty()){
                subCatList.clear()
                dressesTypeList.get(0).subcategory.forEach {
                    subCatList.add(it.name)
                }
                sareeCatViewmodel.dressesTypeData.removeObservers(this)
                callback(subCatList,dressesTypeList)
            }
        }
    }

    private fun setVastracatSpinner(){
        getSelectedVastraCatList {catList,allVastraDataList->
            val adapter = ArrayAdapter(
                this,
                R.layout.item_spinner_text,
                catList
            )
            binding.materialSpinner.setAdapter(adapter)

          /*  allVastraDataList.get(0).subcategory.forEach { selectedSubCat->
                if(selectedVastraSubCategory?.name.equals(selectedSubCat.name,true)){
                    binding.materialSpinner.setText(selectedSubCat.name, false) // default value
                }
            }*/
            binding.materialSpinner.post {
                if(selectedVastraSubCategory?.items?.size==0){
                    val fisrtSubCatDefault = allVastraDataList.get(0).subcategory.get(0)
                    binding.materialSpinner.setText(fisrtSubCatDefault.name, false)
                    setVastraItemListFromSpinner(fisrtSubCatDefault,false)
                }else{
                    allVastraDataList.get(0).subcategory.forEach { selectedSubCat->
                        if(selectedVastraSubCategory?.name?.startsWith("searchBy:",true) == true){
                            val searchByName = selectedVastraSubCategory?.name?.split(":")?.get(1)
                            binding.materialSpinner.setText(searchByName, false)
                        }else{
                            if(selectedVastraSubCategory?.name.equals(selectedSubCat.name,true)){
                                binding.materialSpinner.setText(selectedSubCat.name, false) // default value
                            }
                        }
                    }
                }
            }
            binding.materialSpinner.setOnItemClickListener { _, _, position, _ ->
                binding.materialSpinner.post {
                    val selected = catList.get(position)
                    allVastraDataList.get(0).subcategory.forEach { selectedSubCat->
                        if(selected.equals(selectedSubCat.name,true)){
                            setVastraItemListFromSpinner(selectedSubCat,false)
                        }
                    }
                }
            }
            binding.materialSpinner.setDropDownBackgroundDrawable(
                ContextCompat.getDrawable(this, R.drawable.bg_dropdown_purple)
            )
        }
    }

   /* private fun setVastraItemList(selectedDressType: DressesTypeDataModel.Data.Subcategory,isTryOnProcessStart:Boolean){
        binding.txtCategoryName.text = selectedDressType.name
        val dressTypeSubcatAdapter = VastraSubCategoryItemAdapter(selectedDressType.items){selectedSubcategoryData,position->
            startFaceSwapProcess(selectedSubcategoryData.garmentid)
        }
        binding.recyclerVastraItems.adapter = dressTypeSubcatAdapter
        binding.rlMain.isVisible = true
    *//*   binding.recyclerVastraItems.post{
           if(selectedDressType.items.size>3){
               val itemHeight = resources.getDimensionPixelSize(com.intuit.sdp.R.dimen._125sdp)
               binding.recyclerVastraItems.layoutParams.height = itemHeight * 3
               binding.rlMain.layoutParams.height = itemHeight * 3
               binding.recyclerVastraItems.adapter = dressTypeSubcatAdapter
               binding.rlMain.isVisible = true
               startSelectedItemTryOnProcess(dressTypeSubcatAdapter)
           }
        }*//*
        // Up arrow scroll
        binding.btnUp.setOnClickListener {
            binding.recyclerVastraItems.smoothScrollBy(0, -200)
        }

        // Down arrow scroll
        binding.btnDown.setOnClickListener {
            binding.recyclerVastraItems.smoothScrollBy(0, 200)
        }

        if(isTryOnProcessStart){
            binding.recyclerVastraItems.post {
                if(SareeCategoryDataRepository.startAutoTryOnProcess){
                    startSelectedItemTryOnProcess(dressTypeSubcatAdapter)
                }
            }
        }
    }*/

    private fun setupVastraRecycler() {
        vastraAdapter = VastraSubCategoryItemAdapter { selectedItem, _ ->
            // Heavy try-on should NOT block UI
            binding.recyclerVastraItems.post {
                startFaceSwapProcess(selectedItem.garmentid)
            }
        }

        binding.recyclerVastraItems.apply {
            adapter = vastraAdapter
            setHasFixedSize(true)
            itemAnimator = null // VERY IMPORTANT for kiosk performance
        }

        // Set listeners ONCE
        binding.btnUp.setOnClickListener {
            binding.recyclerVastraItems.smoothScrollBy(0, -200)
        }

        binding.btnDown.setOnClickListener {
            binding.recyclerVastraItems.smoothScrollBy(0, 200)
        }
    }

    private fun setVastraItemListFromSpinner(
        selectedDressType: DressesTypeDataModel.Data.Subcategory,
        isTryOnProcessStart: Boolean
    ) {
        binding.txtCategoryName.text = selectedDressType.name
        binding.rlMain.isVisible = true

        lifecycleScope.launch {

            // Allow spinner UI to finish first (important)
            delay(50)

            // Background preparation (safe even if small)
            val items = withContext(Dispatchers.Default) {
                selectedDressType.items
            }

            // Update UI
            withContext(Dispatchers.Main) {
                vastraAdapter.submitList(items.toList()) {
                    vastraAdapter.resetSelection()
                    binding.recyclerVastraItems.scrollToPosition(0)
                }
            }

            // Auto try-on AFTER UI settles
            if (isTryOnProcessStart && SareeCategoryDataRepository.startAutoTryOnProcess) {
                binding.recyclerVastraItems.post {
                    startSelectedItemTryOnProcess(vastraAdapter)
                }
            }
        }
    }


    override fun onStop() {
        super.onStop()
        dismissTryOnProcessingDialog()
        SareeCategoryDataRepository.startAutoTryOnProcess = false
    }

    override fun onDestroy() {
        super.onDestroy()
        SareeCategoryDataRepository.startAutoTryOnProcess = false
    }

    /*private fun startFaceSwapProcess(dressTryOnID: String) {
        // ✅ Reset old observers before starting new one
        resetAllOberserver()
        ViewControll.diableActivityClick(this)
        val selectedImageFile = PrefsManager.getCapturedImage(this)
        showTryOnProcessingDialog()
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        sareeCatViewmodel.fetchDressTryOnAPI(this,dressTryOnID,deviceId)
        sareeCatViewmodel.dressTryOnResultData.observe(this){tryOnResultData->
            if(tryOnResultData!=null){
                lastDressTryOnResultData = tryOnResultData
                resetAllOberserver()
                changeSareeTryOnResult(tryOnResultData.tryon_image,tryOnResultData.result_id)
                gotoNextScreen(tryOnResultData.tryon_image,tryOnResultData.result_id)
            }
        }
        sareeCatViewmodel.error.observe(this){errorMsg->
            if(errorMsg!=null){
                dismissTryOnProcessingDialog()
                var title = getString(R.string.no_clear_photo_detect)
                var message = getString(R.string.no_body_detect_msg)
                if(errorMsg.equals(APIConstant.serverTimeOut)){
                    title = getString(R.string.server_busy)
                    message = getString(R.string.server_traffic)
                }
                val alertDialog = if(isHttpUrl(PrefsManager.getCapturedImage(this))){
                    ShowErrorAlertDialog(
                        ShowErrorAlertDialog.ImageSourceType.FromUrl(selectedImageFile), title, message)
                }else{
                    ShowErrorAlertDialog(
                        ShowErrorAlertDialog.ImageSourceType.FromFile(File(selectedImageFile)), title, message)
                }
                alertDialog.show(supportFragmentManager, "ShowErrorAlertDialog")
                resetAllOberserver()
                binding.llDressTryOnProcess.llMainRoot.isVisible = false
                ViewControll.enableActivityClick(this)
            }
        }
    }*/

    private fun startFaceSwapProcess(dressTryOnID: String) {
        LoaderManager.show(this,findViewById(android.R.id.content),true)
        LoaderManager.setMessage("✨ Preparing your look…\n" +
                "Please wait while we style it perfectly.")
        Handler(Looper.getMainLooper()).postDelayed({

            resetAllOberserver()
            isHandled = false

            ViewControll.diableActivityClick(this)

            val selectedImageFile = PrefsManager.getCapturedImage(this)
            val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)

            lifecycleScope.launch {

                // ✅ Let UI finish current frame (CRITICAL FOR ANDROID 14)
                delay(16)

                showTryOnProcessingDialog()

                // ✅ Attach observers BEFORE calling API
                observeTryOnResult(selectedImageFile)

                // Small delay so dialog fully attaches
                delay(50)

                LoaderManager.remove(this@VastraTryOnActivity)
                sareeCatViewmodel.fetchDressTryOnAPI(this@VastraTryOnActivity, dressTryOnID, deviceId)
            }

        },100)

    }

    private fun observeTryOnResult(selectedImageFile: String) {

        sareeCatViewmodel.dressTryOnResultData.observe(this) { data ->

            if (data == null || isHandled) return@observe
            if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return@observe

            isHandled = true   // ✅ STOP further events

            dismissTryOnProcessingDialog()

            changeSareeTryOnResult(data.tryon_image, data.result_id)
            gotoNextScreen(data.tryon_image, data.result_id)

            resetAllOberserver()
        }

        sareeCatViewmodel.error.observe(this) { errorMsg ->

            if (errorMsg == null || isHandled) return@observe
            if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return@observe

            isHandled = true   // ✅ STOP if success already came

            dismissTryOnProcessingDialog()

            var title = getString(R.string.server_connection)
            var message = getString(R.string.server_error_alert)

            if (errorMsg == APIConstant.serverTimeOut) {
                title = getString(R.string.server_busy)
                message = getString(R.string.server_traffic)
            } else if (errorMsg.isNotBlank()) {
                title = getString(R.string.app_name)
                message = errorMsg
            }

            val alertDialog =
                if (isHttpUrl(selectedImageFile)) {
                    ShowErrorAlertDialog(
                        ShowErrorAlertDialog.ImageSourceType.FromUrl(selectedImageFile),
                        title,
                        message
                    )
                } else {
                    ShowErrorAlertDialog(
                        ShowErrorAlertDialog.ImageSourceType.FromFile(File(selectedImageFile)),
                        title,
                        message
                    )
                }

            alertDialog.show(supportFragmentManager, "ShowErrorAlertDialog")

            binding.llDressTryOnProcess.llMainRoot.isVisible = false
            ViewControll.enableActivityClick(this@VastraTryOnActivity)

            resetAllOberserver()
        }
    }
//
//    private fun observeTryOnResult(selectedImageFile: String) {
//
//        sareeCatViewmodel.dressTryOnResultData.observe(this) { tryOnResultData ->
//            if (tryOnResultData != null) {
//                if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return@observe
//                changeSareeTryOnResult(tryOnResultData.tryon_image, tryOnResultData.result_id)
//                gotoNextScreen(tryOnResultData.tryon_image, tryOnResultData.result_id)
//                resetAllOberserver()
//            }
//        }
//
//        sareeCatViewmodel.error.observe(this) { errorMsg ->
//            if (errorMsg != null) {
//
//                if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return@observe
//
//                dismissTryOnProcessingDialog()
//
//                var title = getString(R.string.server_connection)
//                var message = getString(R.string.server_error_alert)
//
//                if (errorMsg == APIConstant.serverTimeOut) {
//                    title = getString(R.string.server_busy)
//                    message = getString(R.string.server_traffic)
//                }
//
//                val alertDialog =
//                    if (isHttpUrl(selectedImageFile)) {
//                        ShowErrorAlertDialog(
//                            ShowErrorAlertDialog.ImageSourceType.FromUrl(selectedImageFile),
//                            title,
//                            message
//                        )
//                    } else {
//                        ShowErrorAlertDialog(
//                            ShowErrorAlertDialog.ImageSourceType.FromFile(File(selectedImageFile)),
//                            title,
//                            message
//                        )
//                    }
//
//                alertDialog.show(supportFragmentManager, "ShowErrorAlertDialog")
//                binding.llDressTryOnProcess.llMainRoot.isVisible = false
//                ViewControll.enableActivityClick(this@VastraTryOnActivity)
//                resetAllOberserver()
//            }
//        }
//    }

    private fun resetAllOberserver(){
        sareeCatViewmodel.resetTryOnResultData()
        sareeCatViewmodel.dressTryOnResultData.removeObservers(this)
        sareeCatViewmodel.error.removeObservers(this)
    }

    private fun changeSareeTryOnResult(dressTryOnResultUrl: String, resultId: String) {
        try {
           /* Glide.with(this)
                .asBitmap()
                .load(dressTryOnResultUrl)
                .into(object : CustomTarget<Bitmap>() {
                    override fun onResourceReady(
                        resource: Bitmap,
                        transition: Transition<in Bitmap>?
                    ) {
                        // Use the bitmap here
                        binding.imageCapturedPhoto.setImageBitmap(resource)
                        binding.llDressTryOnProcess.llMainRoot.isVisible = false
//                        binding.llDownloadOption.isVisible = true
                        ViewControll.enableActivityClick(this@VastraTryOnActivity)
//                        binding.llToolbar.icDone.isVisible = true
                    }

                    override fun onLoadCleared(placeholder: Drawable?) {
                        // Handle cleanup if necessary
                    }

                    override fun onLoadFailed(errorDrawable: Drawable?) {
                        binding.llDressTryOnProcess.llMainRoot.isVisible = false
                        ViewControll.enableActivityClick(this@VastraTryOnActivity)
                    }
                })*/
            binding.llDressTryOnProcess.llMainRoot.isVisible = false
            ViewControll.enableActivityClick(this)
            Glide.with(this)
                .load(dressTryOnResultUrl)
                .placeholder(ViewControll.setLoaderDrawble(this))
                .into(binding.imageCapturedPhoto)
        }catch (e:Exception){
            binding.llDressTryOnProcess.llMainRoot.isVisible = false
            ViewControll.enableActivityClick(this)
            e.printStackTrace()
        }

    }

    private fun gotoNextScreen(tryOnResultUrl: String, resultId: String){
      /*  dismissTryOnProcessingDialog()
        binding.btnNextScreen.isVisible = true
        binding.btnNextScreen.setOnClickListener {
            val intent = Intent(this,VastraTryOnResultActivity::class.java)
            intent.putExtra(AppConstant.TRY_ON_RESULT,tryOnResultUrl)
            intent.putExtra(AppConstant.TRY_ON_RESULT_ID,resultId)
            startActivity(intent)
            overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
        }*/
        val intent = Intent(this,VastraTryOnResultActivity::class.java)
        intent.putExtra(AppConstant.TRY_ON_RESULT,tryOnResultUrl)
        intent.putExtra(AppConstant.TRY_ON_RESULT_ID,resultId)
        startActivity(intent)
//        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun setLottieDressTryOnAnimation(selectedFile:File) {
        getImageDimensions(selectedFile) { size ->
            val width = size.first
            val height = size.second
            val lottieDrawable = LottieDrawable()
            val composition = LottieCompositionFactory.fromRawResSync(
                this,
                R.raw.vastra_tryon_processing
            ).value

            lottieDrawable.composition = composition
            lottieDrawable.repeatMode = LottieDrawable.REVERSE
            lottieDrawable.repeatCount = LottieDrawable.INFINITE
            val maxFrame = (lottieDrawable.maxFrame - 5).toInt()
            lottieDrawable.setMinAndMaxFrame(1, maxFrame)
           /* if (width != 0 && height != 0) {
                val displayMetrics = resources.displayMetrics
                val screenWidth = displayMetrics.widthPixels / displayMetrics.density
                val screenHeight = displayMetrics.heightPixels / displayMetrics.density
                val imgWidth = width.toFloat().div(displayMetrics.density) ?: 0f
                val imgHeight = height.toFloat().div(displayMetrics.density) ?: 0f

                // Scale proportionally
                val widthRatio = screenWidth / imgWidth
                val heightRatio = screenHeight / imgHeight
                val scaleFactor = minOf(widthRatio, heightRatio)

                // Convert back to pixels
                val adjustedWidth = (imgWidth * scaleFactor * displayMetrics.density).toInt()
                val adjustedHeight = (imgHeight * scaleFactor * displayMetrics.density).toInt()
                binding.llDressTryOnProcess.llMainRoot.layoutParams.width = adjustedWidth
                binding.llDressTryOnProcess.llMainRoot.layoutParams.height = adjustedHeight
                binding.llDressTryOnProcess.llMainRoot.requestLayout()
            }*/
            binding.llDressTryOnProcess.lottieView.setImageDrawable(lottieDrawable)
            lottieDrawable.playAnimation()
        }
    }

    private fun setLottieVastraTryOnAnimation() {
        val lottieDrawable = LottieDrawable()
        val composition = LottieCompositionFactory.fromRawResSync(
            this,
            R.raw.vastra_tryon_processing_new
        ).value
        lottieDrawable.composition = composition
        lottieDrawable.speed = 0.5f
        lottieDrawable.repeatMode = LottieDrawable.REVERSE
        lottieDrawable.repeatCount = LottieDrawable.INFINITE
        binding.llDressTryOnProcess.lottieView.setImageDrawable(lottieDrawable)
        lottieDrawable.playAnimation()
    }

    private fun showTryOnProcessingDialog(){
        if (vastraTryOnProcessingDialog?.isAdded == true) {
            return
        }
        if (vastraTryOnProcessingDialog == null) {
            vastraTryOnProcessingDialog = VastraTryOnProcessingFragment()
        }
        vastraTryOnProcessingDialog?.show(supportFragmentManager, "VastraTryOnProcessingFragment")
//        val intent = Intent(this,VastraTryOnProcessFullscreenActivity::class.java)
//        startActivity(intent)
    }

    private fun dismissTryOnProcessingDialog(){
//        vastraTryOnProcessingDialog?.dismissDialogSafe()
        try {
          /*  if (vastraTryOnProcessingDialog?.isAdded == true) {
                vastraTryOnProcessingDialog?.dismissDialogSafe()
            }
            vastraTryOnProcessingDialog = null*/
            if (!isFinishing && !isDestroyed) {
                runOnUiThread {
                    try {
                        if (vastraTryOnProcessingDialog?.isAdded == true) {
                            vastraTryOnProcessingDialog?.dismissDialogSafe()
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        vastraTryOnProcessingDialog = null
                    }
                }
            } else {
                vastraTryOnProcessingDialog = null
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun getImageDimensions(file: File,callback:(Pair<Int, Int>)->Unit) {
        try {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, options)
            return callback(Pair(options.outWidth, options.outHeight))
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return callback(Pair(0,0))
    }
}

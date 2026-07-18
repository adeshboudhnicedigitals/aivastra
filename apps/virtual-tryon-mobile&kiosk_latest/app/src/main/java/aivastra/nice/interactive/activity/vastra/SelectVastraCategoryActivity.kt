package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.camera.CapturePhotoActivity
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivitySelectVastraCategoryBinding
import aivastra.nice.interactive.dialog.SelectedVastraThemePreviewDialog
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import androidx.core.view.isVisible
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class SelectVastraCategoryActivity : BaseActivity() {

    private lateinit var binding:ActivitySelectVastraCategoryBinding
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var vastraFor = "women"
    private var searchProductAdapter : VastraCategoryItemAdapter? = null
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySelectVastraCategoryBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        vastraFor = intent?.extras?.getString(AppConstant.VASTRA_FOR).toString()
        ViewControll.setCompanyLogoHorizontal(this,binding.llToolbar.appLogo)
        getVastraCategoryList()
        addProductSearchListener()
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
    }

    private fun getVastraCategoryList(){
//        binding.llLoading.txtMsg.text = getString(R.string.uploading_your_photo)
        LoaderManager.show(this,findViewById(android.R.id.content),true)
        LoaderManager.setMessage("Fetching your style list…")
        sareeCatViewmodel.fetchDressesTypeData(vastraFor)
        sareeCatViewmodel.error.observe(this){errorMsg->
            LoaderManager.remove(this)
            if(errorMsg!=null){
//                binding.llLoading.llFetchingData.isVisible = false
                ViewControll.showMessage(this,errorMsg)
                resetObserver()
            }
        }
        sareeCatViewmodel.dressesTypeData.observe(this){dressesTypeList->
            LoaderManager.remove(this)
            if(dressesTypeList!=null && dressesTypeList.isNotEmpty()){
                if(dressesTypeList.get(0).subcategory.isNotEmpty()){
                    val dressesTypeAdapter = VastraSubCategoryAdapter(dressesTypeList.get(0).subcategory){ dressSubCatItemData,position->
                        setVastraItemList(dressSubCatItemData)
                    }
                    binding.recyclerVastraCategory.adapter = dressesTypeAdapter
                    binding.rlMainCatlist.isVisible = true
                    /*  binding.recyclerVastraCategory.post{
                          val itemHeight = resources.getDimensionPixelSize(com.intuit.sdp.R.dimen._40sdp)
                          binding.recyclerVastraCategory.layoutParams.height = itemHeight * 6
                          binding.rlMain.layoutParams.height = itemHeight * 6
                      }*/
                    dressesTypeAdapter.selectedItemPositionDefault(0)
                }
            }
        }
    }

    private fun setVastraItemList(selectedDressType: DressesTypeDataModel.Data.Subcategory){
        binding.recyclerVastraItem.isVisible = true
        binding.recyclerSearchProductItem.isVisible = false
        val dressTypeSubcatAdapter = VastraCategoryItemAdapter(selectedDressType.items){selectedVastraItem,position->
//            gotoNextScreen(selectedDressType,selectedVastraItem)
            openSelectedVastraPreviewDialog(selectedDressType,selectedVastraItem)
        }
        binding.recyclerVastraItem.adapter = dressTypeSubcatAdapter
    }

    private fun addProductSearchListener(){
        binding.etProductSearch.addTextChangedListener { text ->
            searchJob?.cancel()
            searchJob = lifecycleScope.launch {
                delay(500) // Safe delay between keystrokes
                val query = text.toString().trim()
                if (query.isNotEmpty()) {
                    binding.iconSearch.setImageResource(R.drawable.icon_cancle)
                    binding.iconSearch.tag = R.drawable.icon_cancle
                }else{
                    binding.iconSearch.setImageResource(R.drawable.search_icon)
                    binding.iconSearch.tag = R.drawable.search_icon
                    binding.recyclerVastraItem.isVisible = true
                    binding.recyclerSearchProductItem.isVisible = false
                }
            }
        }

        binding.etProductSearch.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                val query = binding.etProductSearch.text.toString().trim()
                filterProductBySku(query)
                true
            } else {
                false
            }
        }

        binding.iconSearch.setOnClickListener {
            val iconId = binding.iconSearch.tag as? Int
            when (iconId) {
                R.drawable.icon_cancle -> {
                    binding.recyclerVastraItem.isVisible = true
                    binding.recyclerSearchProductItem.isVisible = false
                    binding.etProductSearch.text.clear()
                    binding.iconSearch.setImageResource(R.drawable.search_icon)
                    binding.iconSearch.tag = R.drawable.search_icon
                    ViewControll.hideKeyboard(this)
                }
            }
        }
    }

    private fun filterProductBySku(searchBy:String){
        ViewControll.hideKeyboard(this)
        sareeCatViewmodel.filterProductBySKUNumber(searchBy) { results, errorMsg ->
            if (results != null) {
                setSearchProductItemList(results, searchBy)
            } else {
                binding.recyclerVastraItem.isVisible = true
                binding.recyclerSearchProductItem.isVisible = false
                if (errorMsg != null) {
                    ViewControll.showMessage(this, errorMsg)
                }
            }
        }
    }

    private fun setSearchProductItemList(productItemList: ArrayList<DressesTypeDataModel.Data.Subcategory.Item>, searchBy: String){
        binding.recyclerVastraItem.isVisible = false
        binding.recyclerSearchProductItem.isVisible = true
        if(searchProductAdapter!=null){
            searchProductAdapter?.updateSearchBy(searchBy)
            searchProductAdapter?.updateNewList(productItemList)
        }else{
            searchProductAdapter = VastraCategoryItemAdapter(productItemList){selectedVastraItem,position->
//                gotoNextScreen(DressesTypeDataModel.Data.Subcategory(),selectedVastraItem)
                val searchProductSubCat = DressesTypeDataModel.Data.Subcategory().apply {
                    items = productItemList
                    name = "searchBy:${searchProductAdapter?.currentSearchBy}"
                }
                openSelectedVastraPreviewDialog(searchProductSubCat,selectedVastraItem)
            }
            binding.recyclerSearchProductItem.adapter = searchProductAdapter
            searchProductAdapter?.updateSearchBy(searchBy)
        }
    }

    private fun resetObserver(){
        sareeCatViewmodel.resetErrorData()
        sareeCatViewmodel.error.removeObservers(this)
    }

    private fun gotoNextScreen(selectedDressTypeData: DressesTypeDataModel.Data){
        SareeCategoryDataRepository.setSelectedDressTypeData(selectedDressTypeData)
        val intent = Intent(this,VastraSubCategoryActivity::class.java)
        intent.putExtra(AppConstant.SELECTED_VASTRA_CAT,selectedDressTypeData)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun gotoNextScreen(selectedVastraSubcat: DressesTypeDataModel.Data.Subcategory,
                               selectedVastraItem:DressesTypeDataModel.Data.Subcategory.Item){
        SareeCategoryDataRepository.startAutoTryOnProcess = true
        val intent = Intent(this,CapturePhotoActivity::class.java)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubcat)
        intent.putExtra(AppConstant.SELECTED_VASTRA_ITEM,selectedVastraItem)
        intent.putExtra(AppConstant.VASTRA_FOR,vastraFor)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun openSelectedVastraPreviewDialog(selectedVastraSubcat: DressesTypeDataModel.Data.Subcategory,
                                                selectedVastraItem:DressesTypeDataModel.Data.Subcategory.Item){
        val selectedVastraThemePreviewDialog = SelectedVastraThemePreviewDialog(selectedVastraSubcat,selectedVastraItem){selectedVastraItem->
            gotoNextScreen(selectedVastraSubcat,selectedVastraItem)
        }
        selectedVastraThemePreviewDialog.show(supportFragmentManager, "SelectedVastraThemePreviewDialog")
    }
}
package aivastra.nice.interactive.activity.vastra

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityVastraSubCategoryBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.os.Build
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide

class VastraSubCategoryActivity : BaseActivity() {

    private lateinit var binding:ActivityVastraSubCategoryBinding
    private var selectedVastraCategory : DressesTypeDataModel.Data? = null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityVastraSubCategoryBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            selectedVastraCategory = intent?.extras?.getSerializable(AppConstant.SELECTED_VASTRA_CAT,DressesTypeDataModel.Data::class.java)!!
        }else{
            selectedVastraCategory= intent.extras?.getSerializable(AppConstant.SELECTED_VASTRA_CAT) as DressesTypeDataModel.Data
        }
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        Glide.with(this@VastraSubCategoryActivity)
            .load(PrefsManager.getCapturedImage(this))
            .into(binding.imageCapturedPhoto)
        selectedVastraCategory?.let {
            setSubcategoryList(it)
        }
        binding.iconBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
    }

    private fun setSubcategoryList(selectedDressType:DressesTypeDataModel.Data){
        val dressTypeSubcatAdapter = VastraSubCategoryAdapter(selectedDressType.subcategory){selectedSubcategoryData,position->
            gotoNextScreen(selectedSubcategoryData)
        }
        binding.recyclerVastraSubcategory.adapter = dressTypeSubcatAdapter
        binding.llVastraSubcategoryList.isVisible = true
        binding.recyclerVastraSubcategory.post{
            if(selectedDressType.subcategory.size>3){
                val itemHeight = resources.getDimensionPixelSize(com.intuit.sdp.R.dimen._85sdp)
                binding.recyclerVastraSubcategory.layoutParams.height = itemHeight * 4
            }
        }
        // Up arrow scroll
        binding.btnUp.setOnClickListener {
            binding.recyclerVastraSubcategory.smoothScrollBy(0, -200)
        }

        // Down arrow scroll
        binding.btnDown.setOnClickListener {
            binding.recyclerVastraSubcategory.smoothScrollBy(0, 200)
        }
    }

    private fun gotoNextScreen(selectedVastraSubcat: DressesTypeDataModel.Data.Subcategory){
        selectedVastraCategory?.let { SareeCategoryDataRepository.setSelectedDressTypeData(it) }
        val intent = Intent(this,VastraTryOnActivity::class.java)
        intent.putExtra(AppConstant.SELECTED_VASTRA_SUBCAT,selectedVastraSubcat)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }
}
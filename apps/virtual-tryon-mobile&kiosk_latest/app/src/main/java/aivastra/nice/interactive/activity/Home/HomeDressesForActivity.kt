package aivastra.nice.interactive.activity.Home

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.VastraFor.VastraForDataAdapter
import aivastra.nice.interactive.activity.camera.CapturePhotoActivity
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.activity.profile.PofileActivity
import aivastra.nice.interactive.activity.vastra.SelectVastraCategoryActivity
import aivastra.nice.interactive.customview.ButtonAnimationHelper
import aivastra.nice.interactive.databinding.ActivityHomeDressesForBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.util.Log
import android.view.View
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.core.view.isVisible
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.loader.content.Loader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class HomeDressesForActivity : BaseActivity() {

    private lateinit var binding:ActivityHomeDressesForBinding
    private var vastraForAdapter: VastraForDataAdapter?= null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHomeDressesForBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    @OptIn(ExperimentalGetImage::class)
    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        setVastraForGenderDataList()
        ViewControll.setCompanyLogo(this,binding.appLogo)
        binding.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch(Dispatchers.IO) {
            ViewControll.clearTryOnCameraCache(this@HomeDressesForActivity)
        }
    }

    private fun setVastraForGenderDataList(){
        LoaderManager.show(this,findViewById(android.R.id.content),false)
        sareeCatViewmodel.dressesForData.removeObservers(this)
        sareeCatViewmodel.showTryOnSessionMessage.removeObservers(this)
        sareeCatViewmodel.error.removeObservers(this)
        if(SareeCategoryDataRepository.getDressesForData().isEmpty()){
            sareeCatViewmodel.fetchDressesForAPI()
        }else{
            sareeCatViewmodel.getDressesForList()
            sareeCatViewmodel.getSessionMessage()
        }
        sareeCatViewmodel.dressesForData.observe(this){ dressesForList ->
            vastraForAdapter = VastraForDataAdapter(this,dressesForList){dressesForItem->
                PrefsManager.putString(AppConstant.VASTRA_FOR,dressesForItem.ctype)
                val intent = Intent(this@HomeDressesForActivity, SelectVastraCategoryActivity::class.java)
                intent.putExtra(AppConstant.VASTRA_FOR,dressesForItem.ctype)
                startActivity(intent)
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
            }
            binding.recyclerVastraForlist.adapter = vastraForAdapter
            LoaderManager.remove(this)
        }
        sareeCatViewmodel.showTryOnSessionMessage.observe(this){message->
            if(message.isNotEmpty()){
                binding.txtSessionMessage.text = message
            }
        }
        // Observe error LiveData
        sareeCatViewmodel.error.observe(this){ error ->
            LoaderManager.remove(this)
            if(error!=null && error.isNotEmpty()){
                ViewControll.showSnackErrorMsg(this,error){
                    finish()
                }
            }
            Log.e("aivastra", localClassName + " Error:=" + error)
        }
    }
}
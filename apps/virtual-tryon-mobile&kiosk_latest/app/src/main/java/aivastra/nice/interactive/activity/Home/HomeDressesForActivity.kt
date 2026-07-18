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
import aivastra.nice.interactive.activity.vastra.SelectVastraCategoryActivity
import aivastra.nice.interactive.customview.ButtonAnimationHelper
import aivastra.nice.interactive.databinding.ActivityHomeDressesForBinding
import aivastra.nice.interactive.databinding.PopupProfileMenuBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.PopupWindow
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
        ViewControll.setCompanyLogoHorizontal(this,binding.appLogo)
        binding.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
        binding.imgProfile.setOnClickListener {
            showProfileMenu(it)
        }
        setProfileInitials()
    }

    private fun setProfileInitials() {
        if (PrefsManager.isUserExist) {
            binding.imgProfile.text = initialsFor(PrefsManager.loginUserInfo.user.username)
        }
    }

    private fun initialsFor(name: String): String {
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return when {
            parts.size >= 2 -> "${parts[0].first()}${parts[1].first()}".uppercase()
            parts.size == 1 -> parts[0].take(2).uppercase()
            else -> "?"
        }
    }

    private fun showProfileMenu(anchor: View) {
        val popupBinding = PopupProfileMenuBinding.inflate(layoutInflater)
        val userData = PrefsManager.loginUserInfo
        popupBinding.txtProfileName.text = userData.user.username.ifBlank { userData.user.email }

        val popupWindow = PopupWindow(
            popupBinding.root,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true,
        )
        popupWindow.isOutsideTouchable = true
        popupWindow.elevation = 8f

        popupBinding.txtLogout.setOnClickListener {
            popupWindow.dismiss()
            showLogoutAlertDialog()
        }

        // img_profile sits at the bottom of the screen, so the popup must open upward —
        // measure it first to compute a negative yOff that places it above the anchor.
        popupBinding.root.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        val yOffset = -(anchor.height + popupBinding.root.measuredHeight)
        popupWindow.showAsDropDown(anchor, 0, yOffset)
    }

    private fun showLogoutAlertDialog() {
        val showAppAlertDialog = ShowAppAlertDialog(
            ShowAppAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.profile_icon),
            getString(R.string.logout),
            getString(R.string.alert_logout),
            getString(R.string.cancel),
            getString(R.string.logout),
        ) {
            val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            LoaderManager.show(this, findViewById(android.R.id.content), false)
            sareeCatViewmodel.userLogoutAPI(deviceId) { isSuccess, errorMsg ->
                LoaderManager.remove(this)
                if (isSuccess) {
                    ViewControll.showMessage(this, "User logout successfully")
                    val intent = Intent(this, aivastra.nice.interactive.activity.launch.SplashScreenActivity::class.java)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    startActivity(intent)
                    finish()
                } else {
                    ViewControll.showSnackErrorMsg(this, errorMsg)
                }
            }
        }
        showAppAlertDialog.show(supportFragmentManager, "ShowAppAlertDialog")
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
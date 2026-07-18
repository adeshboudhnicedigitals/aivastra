package aivastra.nice.interactive.activity.launch

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.HomeDressesForActivity
import aivastra.nice.interactive.activity.auth.LoginActivity
import aivastra.nice.interactive.databinding.ActivitySplashScreenBinding
import aivastra.nice.interactive.databinding.PopupProfileMenuBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.animation.AnimationUtils
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.example.facewixlatest.ApiUtils.APIConstant

class SplashScreenActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySplashScreenBinding
    private lateinit var  sareeCatViewmodel : SareecategoryDataViewModel
    private var isAnimComplete:Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySplashScreenBinding.inflate(layoutInflater)
        setContentView(binding.root)
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        binding.btnTryNow.setOnClickListener {
            if(PrefsManager.isUserExist){
                val intent = Intent(this@SplashScreenActivity, HomeDressesForActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(intent)
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
            }else{
                val intent = Intent(this@SplashScreenActivity, LoginActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(intent)
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
//                callAppLoginAPI()
            }
        }
        binding.imgProfile.setOnClickListener {
            showProfileMenu(it)
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
                    recreate()
                } else {
                    ViewControll.showSnackErrorMsg(this, errorMsg)
                }
            }
        }
        showAppAlertDialog.show(supportFragmentManager, "ShowAppAlertDialog")
    }

    override fun onResume() {
        super.onResume()
        if(PrefsManager.isUserExist){
            ViewControll.setCompanyLogoHorizontal(this,binding.appLogo)
            setUserProfilePhoto()
            binding.imgProfile.isVisible = true
        }
    }

    private fun setUserProfilePhoto(){
        if(PrefsManager.isUserExist){
            val userData = PrefsManager.loginUserInfo
            if(userData.user.merchantPhoto.isNotEmpty()){
                try{
                    Glide.with(this@SplashScreenActivity)
                        .load(APIConstant.BASE_URL + userData.user.merchantPhoto)
                        .placeholder(R.drawable.profile_icon)
                        .error(R.drawable.profile_icon)
                        .into(binding.imgProfile)
                }catch(e:Exception){
                    e.printStackTrace()
                }
            }
        }
    }
}
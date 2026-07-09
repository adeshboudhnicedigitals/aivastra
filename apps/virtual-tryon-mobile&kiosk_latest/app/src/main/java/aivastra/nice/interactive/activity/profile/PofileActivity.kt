package aivastra.nice.interactive.activity.profile

import aivastra.nice.interactive.Loader.LoaderManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.activity.launch.SplashScreenActivity
import aivastra.nice.interactive.databinding.ActivityPofileBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.provider.Settings
import android.widget.ArrayAdapter
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.example.facewixlatest.ApiUtils.APIConstant

class PofileActivity : BaseActivity() {

    private lateinit var binding:ActivityPofileBinding
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPofileBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        if(PrefsManager.isUserExist){
            val userData = PrefsManager.loginUserInfo
            binding.txtUsername.text = userData.user.username
            binding.txtEmail.text = userData.user.email
            if(userData.user.merchantPhoto.isNotEmpty()){
                try{
                    Glide.with(this@PofileActivity)
                        .load(APIConstant.BASE_URL + userData.user.merchantPhoto)
                        .placeholder(R.drawable.profile_icon)
                        .error(R.drawable.profile_icon)
                        .into(binding.imgProfile)
                }catch(e:Exception){
                    e.printStackTrace()
                }
            }
        }
        ViewControll.setCompanyLogoHorizontal(this,binding.llToolbar.appLogo)
        binding.llToolbar.imgBack.setOnClickListener {
            onBackPressedDispatcher.onBackPressed()
        }
        binding.btnLogout.setOnClickListener {
           showLogoutAlertDialog()
        }
        setCaptureTimerSpinner()
    }

    private fun showLogoutAlertDialog(){
        val showAppAlertDialog = ShowAppAlertDialog(ShowAppAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.profile_icon),
            getString(R.string.logout),
            getString(R.string.alert_logout),
            getString(R.string.cancel),
            getString(R.string.logout)){

            val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            LoaderManager.show(this,findViewById(android.R.id.content),false)
            sareeCatViewmodel.userLogoutAPI(deviceId){isSuccess,errorMsg->
                LoaderManager.remove(this)
                if(isSuccess){
                    PrefsManager.deleteuser()
                    ViewControll.showMessage(this,"User logout successfully")
                    val intent = Intent(this@PofileActivity, SplashScreenActivity::class.java)
                    startActivity(intent)
                    overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
                    finishAffinity()
                }else{
                    ViewControll.showSnackErrorMsg(this,errorMsg)
                }
            }
        }
        showAppAlertDialog.show(supportFragmentManager, "ShowAppAlertDialog")
    }

    private fun setCaptureTimerSpinner(){
        val timerList = arrayListOf(
            "None", "5 sec", "10 sec", "15 sec",
            "20 sec", "25 sec", "30 sec"
        )
        val adapter = ArrayAdapter(this, R.layout.item_spinner_text, timerList)
        binding.materialSpinner.setAdapter(adapter)
        val selectedTimer = PrefsManager.getString(AppConstant.CAPTURE_TIMER,"10 sec")
        timerList.forEach {
            if(selectedTimer.equals(it)){
                binding.materialSpinner.setText("$selectedTimer",false)
            }
        }

        binding.materialSpinner.setOnItemClickListener {_, _, position, _ ->
            val selected = timerList.get(position)
            ViewControll.showMessage(this,"Autocapture timer set as $selected")
            PrefsManager.putString(AppConstant.CAPTURE_TIMER,selected)
        }
        binding.materialSpinner.setDropDownBackgroundDrawable(
            ContextCompat.getDrawable(this, R.drawable.bg_dropdown_purple)
        )
    }
}
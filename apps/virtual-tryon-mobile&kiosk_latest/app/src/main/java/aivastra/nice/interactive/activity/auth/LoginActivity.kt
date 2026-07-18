package aivastra.nice.interactive.activity.auth

import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.HomeDressesForActivity
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityLoginBinding
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.DeviceLimitState
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.MotionEvent
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModelProvider

class LoginActivity : BaseActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var isPasswordVisible = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this)[SareecategoryDataViewModel::class.java]
        binding.btnLogin.setOnClickListener {
            if (checkValidation()) {
                callLoginAPI()
            }
        }
        setupPasswordToggle()
    }

    // The eye icon is a drawableEnd on the EditText with no built-in click target, so taps have
    // to be detected manually against the drawable's bounds within the field's touch area.
    private fun setupPasswordToggle() {
        binding.etPassword.setOnTouchListener { v, event ->
            val drawableEnd = binding.etPassword.compoundDrawables[2]
            if (drawableEnd != null && event.action == MotionEvent.ACTION_UP) {
                val touchAreaStart = binding.etPassword.width -
                    binding.etPassword.paddingEnd -
                    drawableEnd.bounds.width()
                if (event.x >= touchAreaStart) {
                    togglePasswordVisibility()
                    v.performClick()
                    return@setOnTouchListener true
                }
            }
            false
        }
    }

    private fun togglePasswordVisibility() {
        isPasswordVisible = !isPasswordVisible
        val selection = binding.etPassword.selectionEnd
        binding.etPassword.inputType = if (isPasswordVisible) {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        } else {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val eyeIcon = if (isPasswordVisible) R.drawable.ic_eye_on else R.drawable.ic_eye_off
        binding.etPassword.setCompoundDrawablesWithIntrinsicBounds(0, 0, eyeIcon, 0)
        binding.etPassword.setSelection(selection.coerceAtMost(binding.etPassword.text?.length ?: 0))
    }

    private fun checkValidation(): Boolean {
        if (binding.etUsername.text.trim().isEmpty()) {
            ViewControll.showMessage(this, "Please enter email")
            return false
        }
        if (binding.etPassword.text.trim().isEmpty()) {
            ViewControll.showMessage(this, "Please enter password")
            return false
        }
        return true
    }

    private fun callLoginAPI() {
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val email = binding.etUsername.text.toString().trim()
        val password = binding.etPassword.text.toString()
        LoaderManager.show(this, findViewById(android.R.id.content), false)
        resetObserver()
        sareeCatViewmodel.userAppLoginAPI(email, password, deviceId)
        observeLoginResult(deviceId)
    }

    private fun callForceLoginAPI(forceLogoutToken: String, deviceId: String) {
        LoaderManager.show(this, findViewById(android.R.id.content), false)
        resetObserver()
        sareeCatViewmodel.forceLogoutOtherDeviceAndLogin(forceLogoutToken, deviceId)
        observeLoginResult(deviceId)
    }

    private fun observeLoginResult(deviceId: String) {
        sareeCatViewmodel.userLoginInfo.observe(this, Observer { userLoginDataModel ->
            LoaderManager.remove(this)
            if (userLoginDataModel != null) {
                ViewControll.showMessage(this, userLoginDataModel.message)
                PrefsManager.saveLoginUserData(userLoginDataModel)
                val intent = Intent(this, HomeDressesForActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(intent)
                finish()
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
            }
        })
        sareeCatViewmodel.deviceLimitReached.observe(this, Observer { state ->
            LoaderManager.remove(this)
            if (state != null) {
                showDeviceLimitDialog(state, deviceId)
            }
        })
        sareeCatViewmodel.error.observe(this, Observer { errorMsg ->
            LoaderManager.remove(this)
            if (!errorMsg.isNullOrBlank()) {
                sareeCatViewmodel.resetAppLoginData()
                ViewControll.showSnackErrorMsg(this, errorMsg)
                resetObserver()
            }
        })
    }

    private fun showDeviceLimitDialog(state: DeviceLimitState, deviceId: String) {
        AlertDialog.Builder(this)
            .setTitle("Device limit reached")
            .setMessage("${state.message}\n\nLogout from the other device and continue here?")
            .setNegativeButton("Cancel") { dialog, _ ->
                dialog.dismiss()
                sareeCatViewmodel.resetAppLoginData()
                resetObserver()
            }
            .setPositiveButton("Logout Other Device") { dialog, _ ->
                dialog.dismiss()
                callForceLoginAPI(state.forceLogoutToken, deviceId)
            }
            .show()
    }

    private fun resetObserver() {
        sareeCatViewmodel.error.removeObservers(this)
        sareeCatViewmodel.userLoginInfo.removeObservers(this)
        sareeCatViewmodel.deviceLimitReached.removeObservers(this)
    }
}
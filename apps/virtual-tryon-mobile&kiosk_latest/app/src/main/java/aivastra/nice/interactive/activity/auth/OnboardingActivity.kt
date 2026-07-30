package aivastra.nice.interactive.activity.auth

import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.HomeDressesForActivity
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityOnboardingBinding
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import android.content.Intent
import android.os.Bundle
import androidx.lifecycle.lifecycleScope
import com.example.facewixlatest.ApiUtils.ApiErrorPresenter
import kotlinx.coroutines.launch

class OnboardingActivity : BaseActivity() {

    private lateinit var binding: ActivityOnboardingBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityOnboardingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.etContactName.setText(SareeCategoryDataRepository.onboardingSuggestedName)
        binding.btnSubmit.setOnClickListener { submitOnboarding() }
    }

    private fun submitOnboarding() {
        val phone = binding.etPhone.text.toString().trim()
        if (!Regex("^\\+?[0-9]{10,15}$").matches(phone)) {
            binding.etPhone.error = "Enter a valid mobile number"
            return
        }

        binding.btnSubmit.isEnabled = false
        LoaderManager.show(this, findViewById(android.R.id.content), false)
        lifecycleScope.launch {
            try {
                SareeCategoryDataRepository.submitOnboarding(
                    phone = phone,
                    contactName = binding.etContactName.text.toString().trim(),
                    companyName = binding.etShopName.text.toString().trim(),
                    businessAddress = binding.etAddress.text.toString().trim(),
                )
                LoaderManager.remove(this@OnboardingActivity)
                startActivity(Intent(this@OnboardingActivity, HomeDressesForActivity::class.java))
                finish()
                overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
            } catch (error: Exception) {
                LoaderManager.remove(this@OnboardingActivity)
                binding.btnSubmit.isEnabled = true
                val (title, message) = ApiErrorPresenter.present(error)
                ViewControll.showSnackErrorMsg(this@OnboardingActivity, "$title: $message")
            }
        }
    }
}
package aivastra.nice.interactive.activity.auth

import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityOnboardingBinding
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareeCategoryDataRepository
import android.app.AlertDialog
import android.os.Bundle
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.example.facewixlatest.ApiUtils.ApiErrorPresenter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

class OnboardingActivity : BaseActivity() {

    private lateinit var binding: ActivityOnboardingBinding
    private var applyingPrefill = false
    private var phoneTouched = false
    private var contactNameTouched = false
    private var shopNameTouched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityOnboardingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.etContactName.setText(SareeCategoryDataRepository.onboardingSuggestedName)
        trackEditedFields()
        binding.btnSubmit.isEnabled = false
        binding.btnSubmit.setOnClickListener { submitOnboarding() }
        loadOnboardingState()
    }

    private fun trackEditedFields() {
        binding.etPhone.doAfterTextChanged {
            if (!applyingPrefill) phoneTouched = true
        }
        binding.etContactName.doAfterTextChanged {
            if (!applyingPrefill) contactNameTouched = true
        }
        binding.etShopName.doAfterTextChanged {
            if (!applyingPrefill) shopNameTouched = true
        }
    }

    private fun loadOnboardingState() {
        if (!canShowUi()) return
        binding.btnSubmit.isEnabled = false
        LoaderManager.show(this, findViewById(android.R.id.content), false)
        lifecycleScope.launch {
            try {
                val state = SareeCategoryDataRepository.fetchOnboardingState()
                if (canShowUi()) {
                    val routeResult = MerchantStatusNavigator.route(
                        this@OnboardingActivity,
                        state.getString("merchantStatus"),
                    )
                    if (routeResult == MerchantStatusNavigator.RouteResult.SHOW_ONBOARDING_FORM) {
                        applyPrefill(state.optJSONObject("prefill") ?: JSONObject())
                        binding.btnSubmit.isEnabled = true
                    }
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                if (canShowUi()) showOnboardingLoadError(error)
            } finally {
                LoaderManager.remove(this@OnboardingActivity)
            }
        }
    }

    private fun applyPrefill(prefill: JSONObject) {
        applyingPrefill = true
        try {
            if (!phoneTouched) binding.etPhone.setText(prefill.optString("phone", ""))
            if (!contactNameTouched) {
                binding.etContactName.setText(
                    prefill.optString("contactName", "")
                        .ifBlank { SareeCategoryDataRepository.onboardingSuggestedName },
                )
            }
            if (!shopNameTouched) binding.etShopName.setText(prefill.optString("companyName", ""))
        } finally {
            applyingPrefill = false
        }
    }

    private fun showOnboardingLoadError(error: Exception) {
        val (title, message) = ApiErrorPresenter.present(error)
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage("Couldn't load your account status. $message")
            .setCancelable(false)
            .setNegativeButton("Close") { _, _ -> finish() }
            .setPositiveButton("Retry") { _, _ -> loadOnboardingState() }
            .show()
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
                if (canShowUi()) {
                    MerchantStatusNavigator.route(
                        this@OnboardingActivity,
                        SareeCategoryDataRepository.lastMerchantStatus,
                    )
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                if (canShowUi()) {
                    binding.btnSubmit.isEnabled = true
                    val (title, message) = ApiErrorPresenter.present(error)
                    ViewControll.showSnackErrorMsg(this@OnboardingActivity, "$title: $message")
                }
            } finally {
                LoaderManager.remove(this@OnboardingActivity)
            }
        }
    }

    private fun canShowUi(): Boolean = !isFinishing && !isDestroyed
}

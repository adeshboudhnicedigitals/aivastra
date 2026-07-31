package aivastra.nice.interactive.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.data.models.MerchantOnboardingRequest
import aivastra.nice.interactive.data.repository.OnboardingRepository
import aivastra.nice.interactive.data.repository.OnboardingResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface OnboardingUiState {
    data object Loading : OnboardingUiState
    data class Editing(
        val contactName: String = "",
        val companyName: String = "",
        val phone: String = "",
        val showCompanyNameField: Boolean = true,
        val showPhoneField: Boolean = true,
        val businessAddress: String = "",
        val isSubmitting: Boolean = false,
        val error: String? = null
    ) : OnboardingUiState
    data class Submitted(val merchantId: String) : OnboardingUiState
}

class OnboardingViewModel(
    private val repository: OnboardingRepository = OnboardingRepository()
) : ViewModel() {

    private val _uiState = MutableStateFlow<OnboardingUiState>(OnboardingUiState.Loading)
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    /**
     * Fetches server-side onboarding prefill so the UI can skip any fields that
     * already have data. Contact name stays hidden in the UI and is carried
     * through only as a fallback submit value.
     *
     * Google sign-in may provide a suggested company name, but that is only a
     * suggestion, not confirmed merchant data, so the business-name field stays
     * visible and editable unless the onboarding status endpoint already has a
     * real company name stored for the merchant.
     */
    fun start(suggestedContactName: String? = null, suggestedCompanyName: String? = null) {
        _uiState.update { OnboardingUiState.Loading }
        viewModelScope.launch {
            try {
                val prefill = when (val result = repository.getStatus()) {
                    is OnboardingResult.Success -> result.data.prefill
                    is OnboardingResult.Failure -> null
                }

                val contactName = prefill?.contactName
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?: suggestedContactName?.trim().orEmpty()
                val storedCompanyName = prefill?.companyName
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                val suggestedCompany = suggestedCompanyName
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                val companyName = storedCompanyName ?: suggestedCompany.orEmpty()
                val phoneDigits = prefill?.phone.orEmpty().filter(Char::isDigit).take(10)

                _uiState.update {
                    OnboardingUiState.Editing(
                        contactName = contactName,
                        companyName = companyName,
                        phone = phoneDigits,
                        showCompanyNameField = storedCompanyName == null,
                        showPhoneField = phoneDigits.length != 10
                    )
                }
            } catch (_: Exception) {
                val contactName = suggestedContactName?.trim().orEmpty()
                val companyName = suggestedCompanyName?.trim().orEmpty()
                _uiState.update {
                    OnboardingUiState.Editing(
                        contactName = contactName,
                        companyName = companyName,
                        showCompanyNameField = true,
                        showPhoneField = true
                    )
                }
            }
        }
    }

    fun submit(contactName: String, companyName: String, phone: String, businessAddress: String) {
        val current = _uiState.value as? OnboardingUiState.Editing ?: return
        val phoneDigits = phone.filter(Char::isDigit)
        if (!phoneDigits.matches(Regex("^\\d{10}$"))) {
            _uiState.update { current.copy(error = "Enter a valid 10-digit mobile number") }
            return
        }

        _uiState.update { current.copy(isSubmitting = true, error = null) }
        viewModelScope.launch {
            try {
                val result = repository.submit(
                    MerchantOnboardingRequest(
                        phone = phoneDigits,
                        contactName = contactName.trim().ifBlank { null },
                        companyName = companyName.trim().ifBlank { null },
                        businessAddress = businessAddress.trim().ifBlank { null }
                    )
                )
                _uiState.update {
                    when (result) {
                        is OnboardingResult.Success -> OnboardingUiState.Submitted(result.data.merchantId)
                        is OnboardingResult.Failure -> current.copy(isSubmitting = false, error = result.message)
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    current.copy(isSubmitting = false, error = e.message ?: "Onboarding submission failed")
                }
            }
        }
    }
}

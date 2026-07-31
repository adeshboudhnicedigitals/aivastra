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
     * The Google login response already carries suggested name fields when onboarding
     * is required, so this skips the extra GET round-trip in that case. Any other
     * entry point (password login, or a cold app restart landing here) falls back to
     * fetching prefill from the server.
     */
    fun start(suggestedContactName: String? = null, suggestedCompanyName: String? = null) {
        if (!suggestedContactName.isNullOrBlank() || !suggestedCompanyName.isNullOrBlank()) {
            _uiState.update {
                OnboardingUiState.Editing(
                    contactName = suggestedContactName.orEmpty(),
                    companyName = suggestedCompanyName.orEmpty()
                )
            }
            return
        }

        _uiState.update { OnboardingUiState.Loading }
        viewModelScope.launch {
            try {
                when (val result = repository.getStatus()) {
                    is OnboardingResult.Success -> {
                        val prefill = result.data.prefill
                        _uiState.update {
                            OnboardingUiState.Editing(
                                contactName = prefill.contactName,
                                companyName = prefill.companyName,
                                phone = prefill.phone
                            )
                        }
                    }
                    // Falls back to a blank editable form rather than blocking the user
                    // entirely on a prefill fetch failure — every field is still editable.
                    is OnboardingResult.Failure -> _uiState.update { OnboardingUiState.Editing() }
                }
            } catch (_: Exception) {
                _uiState.update { OnboardingUiState.Editing() }
            }
        }
    }

    fun submit(contactName: String, companyName: String, phone: String, businessAddress: String) {
        val current = _uiState.value as? OnboardingUiState.Editing ?: return
        val phoneTrimmed = phone.trim()
        if (!phoneTrimmed.matches(Regex("^\\+?[0-9]{10,15}$"))) {
            _uiState.update { current.copy(error = "Enter a valid mobile number") }
            return
        }

        _uiState.update { current.copy(isSubmitting = true, error = null) }
        viewModelScope.launch {
            try {
                val result = repository.submit(
                    MerchantOnboardingRequest(
                        phone = phoneTrimmed,
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

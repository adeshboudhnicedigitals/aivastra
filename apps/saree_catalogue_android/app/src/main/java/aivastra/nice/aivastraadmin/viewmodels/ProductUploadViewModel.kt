package aivastra.nice.aivastraadmin.viewmodels

import aivastra.nice.aivastraadmin.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Login.UserSession
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class ProductUploadViewModel : ViewModel() {

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> get() = _error

    private val _sessionResult = MutableLiveData<UserSession?>()
    val sessionResult: LiveData<UserSession?> get() = _sessionResult

    fun resetError() {
        _error.postValue(null)
    }

    fun deviceLogin(email: String, password: String, deviceId: String) {
        viewModelScope.launch {
            try {
                val session = AuthRepository.deviceLogin(email, password, deviceId)
                PrefsManager.saveSession(session)
                PrefsManager.saveRefreshToken(session.refreshToken)
                _sessionResult.postValue(session)
            } catch (e: Exception) {
                _error.postValue(AuthRepository.errorMessage(e))
            }
        }
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                AuthRepository.deviceLogout()
            } catch (e: Exception) {
                // Best-effort: clear the local session regardless of logout failure.
            }
            PrefsManager.deleteuser()
            onDone()
        }
    }

    fun resetSessionResult() {
        _sessionResult.postValue(null)
        _error.postValue(null)
    }
    private val _subcategories = MutableLiveData<List<MerchantCatalogSubcategory>>()
    val subcategories: LiveData<List<MerchantCatalogSubcategory>> get() = _subcategories
    private val _catalogItems = MutableLiveData<List<MerchantCatalogItem>>()
    val catalogItems: LiveData<List<MerchantCatalogItem>> get() = _catalogItems
    fun fetchSubcategories(category: String = "women") { viewModelScope.launch { try { _subcategories.postValue(MerchantCatalogRepository.fetchSubcategories(category)) } catch (e: Exception) { _error.postValue(AuthRepository.errorMessage(e)) } } }
    fun fetchItems(subcategoryId: String) { viewModelScope.launch { try { _catalogItems.postValue(MerchantCatalogRepository.fetchItems(subcategoryId = subcategoryId)) } catch (e: Exception) { _error.postValue(AuthRepository.errorMessage(e)) } } }
    fun searchItems(query: String) { viewModelScope.launch { try { _catalogItems.postValue(MerchantCatalogRepository.fetchItems(search = query)) } catch (e: Exception) { _error.postValue(AuthRepository.errorMessage(e)) } } }
    fun resetSubcategories() { _subcategories.postValue(emptyList()); _error.postValue(null) }
}
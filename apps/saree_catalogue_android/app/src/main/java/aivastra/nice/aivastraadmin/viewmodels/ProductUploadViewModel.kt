package aivastra.nice.aivastraadmin.viewmodels

import aivastra.nice.aivastraadmin.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Login.UserSession
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlinx.coroutines.delay
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

    sealed class GenerateState {
        object Uploading : GenerateState()
        object Generating : GenerateState()
        data class Completed(val resultUrl: String) : GenerateState()
        data class Failed(val message: String) : GenerateState()
    }

    private val _generateState = MutableLiveData<GenerateState>()
    val generateState: LiveData<GenerateState> get() = _generateState

    private var pendingItemId: String? = null

    fun generateProduct(file: java.io.File, subcategoryId: String) {
        viewModelScope.launch {
            try {
                _generateState.postValue(GenerateState.Uploading)
                val contentType = "image/jpeg"
                val presign = MerchantCatalogRepository.presignFlatImage(contentType, file.length())
                MerchantCatalogRepository.uploadFlatImage(presign.uploadUrl, file, contentType)

                _generateState.postValue(GenerateState.Generating)
                val jobId = MerchantCatalogRepository.generate(subcategoryId, presign.r2Key)

                val startedAt = System.currentTimeMillis()
                var status: MerchantCatalogGenerateStatus
                do {
                    delay(2500)
                    status = MerchantCatalogRepository.pollGenerateStatus(jobId)
                    if (System.currentTimeMillis() - startedAt > 180_000) {
                        _generateState.postValue(GenerateState.Failed(APIConstant.serverTimeOut))
                        return@launch
                    }
                } while (!isTerminalGenerateStatus(status.status))

                val resultUrl = status.resultUrl
                if (status.status != "COMPLETED" || resultUrl == null) {
                    _generateState.postValue(GenerateState.Failed(APIConstant.errorSomethingWrong))
                    return@launch
                }

                val item = MerchantCatalogRepository.import(jobId, subcategoryId)
                pendingItemId = item.id
                _generateState.postValue(GenerateState.Completed(resultUrl))
            } catch (e: Exception) {
                _generateState.postValue(GenerateState.Failed(AuthRepository.errorMessage(e)))
            }
        }
    }

    fun finalizeProduct(sku: String, actualPrice: Int, offerPrice: Int, onDone: (Boolean, String) -> Unit) {
        val itemId = pendingItemId
        if (itemId == null) {
            onDone(false, APIConstant.errorSomethingWrong)
            return
        }
        viewModelScope.launch {
            try {
                MerchantCatalogRepository.setPricing(itemId, sku, actualPrice, offerPrice)
                pendingItemId = null
                onDone(true, "")
            } catch (e: Exception) {
                onDone(false, AuthRepository.errorMessage(e))
            }
        }
    }
}
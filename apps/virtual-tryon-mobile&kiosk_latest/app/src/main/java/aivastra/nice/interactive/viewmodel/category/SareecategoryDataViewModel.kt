package aivastra.nice.interactive.viewmodel.category

import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Dress.DressTryOnResultModel
import aivastra.nice.interactive.viewmodel.Dress.DressesForDataModel
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.Dress.UsetTryOnResultDataModel
import aivastra.nice.interactive.viewmodel.Login.UserLoginDataModel
import aivastra.nice.interactive.viewmodel.Qrcode.QrCodeLinkDataModel
import aivastra.nice.interactive.viewmodel.others.UploadImageModel
import android.app.Activity
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.facewixlatest.ApiUtils.APIConstant
import com.example.facewixlatest.ApiUtils.ApiErrorPresenter
import com.example.facewixlatest.ApiUtils.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException

data class DeviceLimitState(
    val message: String,
    val forceLogoutToken: String,
)

class SareecategoryDataViewModel : ViewModel() {

    private val repository = SareeCategoryDataRepository

    private val _allSareeCategory = MutableLiveData<ArrayList<SareeCateDataModel.Data>>()
    val allSareeCategoryList: LiveData<ArrayList<SareeCateDataModel.Data>> get() = _allSareeCategory

    private val _dressesForData = MutableLiveData<ArrayList<DressesForDataModel.Data>>()
    val dressesForData: LiveData<ArrayList<DressesForDataModel.Data>> get() = _dressesForData

    private val _showTryOnSessionMsg = MutableLiveData<String>()
    val showTryOnSessionMessage: LiveData<String> get() = _showTryOnSessionMsg

    private val _tryOnResultDataList = MutableLiveData<ArrayList<UsetTryOnResultDataModel.Data>>()
    val allTryOnResultDataList: LiveData<ArrayList<UsetTryOnResultDataModel.Data>> get() = _tryOnResultDataList

    private val _dressesTypeData = MutableLiveData<ArrayList<DressesTypeDataModel.Data>>()
    val dressesTypeData: LiveData<ArrayList<DressesTypeDataModel.Data>> get() = _dressesTypeData

    private val _dressesItemsListData = MutableLiveData<ArrayList<DressesTypeDataModel.Data.Subcategory.Item>>()
    val dressesItemsListData: LiveData<ArrayList<DressesTypeDataModel.Data.Subcategory.Item>> get() = _dressesItemsListData

    private val _selectedCatItem = MutableLiveData<SareeCateDataModel.Data>()
    val selectedCatItem: LiveData<SareeCateDataModel.Data> get() = _selectedCatItem

    private val _selectedDressType = MutableLiveData<DressesTypeDataModel.Data>()
    val selectedDressType: LiveData<DressesTypeDataModel.Data> get() = _selectedDressType

    private val _dressTryOnResultData = MutableLiveData<DressTryOnResultModel?>()
    val dressTryOnResultData: LiveData<DressTryOnResultModel?> get() = _dressTryOnResultData

    private val _qrCodeLinkData = MutableLiveData<QrCodeLinkDataModel?>()
    val qrCodeLinkData: LiveData<QrCodeLinkDataModel?> get() = _qrCodeLinkData

    private val _userLoginData = MutableLiveData<UserLoginDataModel?>()
    val userLoginInfo: LiveData<UserLoginDataModel?> get() = _userLoginData

    private val _uploadUserImageData = MutableLiveData<UploadImageModel?>()
    val uploadUserImageData: LiveData<UploadImageModel?> get() = _uploadUserImageData

    private val _userOpenQrCodeLink = MutableLiveData<UploadImageModel?>()
    val userOpenQrCodeLink: LiveData<UploadImageModel?> get() = _userOpenQrCodeLink

    private val _closeDialogCallback = MutableLiveData<Boolean>()
    val closeDialogCallback: LiveData<Boolean> get() = _closeDialogCallback

    private val _deviceLimitReached = MutableLiveData<DeviceLimitState?>()
    val deviceLimitReached: LiveData<DeviceLimitState?> get() = _deviceLimitReached

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> get() = _error

    private val _uploadedPhotoR2Key = MutableLiveData<String?>()
    val uploadedPhotoR2Key: LiveData<String?> get() = _uploadedPhotoR2Key

    private val _tryonJobStatus = MutableLiveData<JSONObject?>()
    val tryonJobStatus: LiveData<JSONObject?> get() = _tryonJobStatus
    private var pollingJob: Job? = null

    fun requestCloseDialog() {
        _closeDialogCallback.postValue(true)
    }

    fun resetDialog() {
        _closeDialogCallback.postValue(false)
    }

    fun fetchUserAllTryOnResultListAPI(tryOnResultId: String) {
        _tryOnResultDataList.postValue(repository.getTryOnResults(tryOnResultId))
    }

    fun fetchDressesTypeData(cType: String) {
        viewModelScope.launch {
            runCatching {
                repository.fetchMerchantCatalogTypeData(cType)
            }.onSuccess { model ->
                _dressesTypeData.postValue(model.data)
                repository.savDressesTypeData(model.data)
                _showTryOnSessionMsg.postValue(model.message)
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }
    fun filterProductBySKUNumber(searchBy: String) {
        if (repository.getDressesTypeData().isEmpty()) {
            _error.postValue("App error: catalog is not loaded yet. Please try again.")
            return
        }
        val results = repository.filterLocalProducts(searchBy)
        if (results.isEmpty()) {
            _error.postValue("App error: no product matched that search.")
        } else {
            _dressesItemsListData.postValue(results)
        }
    }
    fun fetchDressesForAPI() {
        val model = repository.getLocalDressesForData()
        _dressesForData.postValue(model.data)
        _showTryOnSessionMsg.postValue(model.message)
        repository.savDressesForData(model.data)
        repository.saveSessionMessage(model.message)
    }

    fun resetTryOnResultData() {
        _dressTryOnResultData.postValue(null)
        _error.postValue(null)
    }

    fun resetUploadImageData() {
        _uploadUserImageData.postValue(null)
        _userOpenQrCodeLink.postValue(null)
        _uploadedPhotoR2Key.postValue(null)
        _error.postValue(null)
    }

    fun resetErrorData() {
        _error.postValue(null)
    }

    fun resetSearchProductData() {
        _error.postValue(null)
        _dressesItemsListData.postValue(null)
    }

    fun resetAppLoginData() {
        _userLoginData.postValue(null)
        _deviceLimitReached.postValue(null)
        _error.postValue(null)
    }

    fun resetQrCodeLinkData() {
        _qrCodeLinkData.postValue(null)
        _uploadUserImageData.postValue(null)
        _userOpenQrCodeLink.postValue(null)
        _uploadedPhotoR2Key.postValue(null)
        _error.postValue(null)
    }

    fun fetchDressTryOnAPI(activity: Activity, garmentId: String, deviceId: String) {
        viewModelScope.launch {
            // _uploadedPhotoR2Key is only populated in whichever Activity's ViewModel instance
            // performed the upload (camera capture or QR-scan) — VastraTryOnActivity gets a fresh
            // ViewModel instance, so it must fall back to the persisted copy.
            val r2Key = _uploadedPhotoR2Key.value?.takeIf { it.isNotBlank() }
                ?: PrefsManager.getUploadedPhotoR2Key()
            if (r2Key.isBlank()) {
                _error.postValue("App error: no confirmed photo to try on. Please capture or upload a photo again.")
                return@launch
            }
            runCatching {
                repository.createTryonJob(garmentId, r2Key)
            }.onSuccess { jobId ->
                pollTryonJob(jobId, garmentId, deviceId, activity)
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }

    private fun pollTryonJob(jobId: String, garmentId: String, deviceId: String, activity: Activity) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            while (true) {
                val status = try {
                    repository.getTryonJobStatus(jobId)
                } catch (cause: Throwable) {
                    val (title, message) = ApiErrorPresenter.present(cause)
                    _error.postValue("$title: $message")
                    return@launch
                }
                _tryonJobStatus.postValue(status)

                when (status.optString("status")) {
                    "COMPLETED" -> {
                        val shareUrl = status.optString("shareUrl", "")
                        if (shareUrl.isBlank()) {
                            _error.postValue("Server error: job completed but no result image was returned.")
                            return@launch
                        }
                        val resultId = jobId
                        repository.saveTryOnResult(
                            UsetTryOnResultDataModel.Data(
                                wixuser = deviceId,
                                garment_id = garmentId,
                                userimage_id = PrefsManager.getImageID(activity).ifBlank { resultId },
                                upload_image_path = shareUrl,
                                tryon_result_path = shareUrl,
                                promt_id = resultId,
                                action_from = "merchant_tryon",
                                id = resultId,
                            ),
                        )
                        _dressTryOnResultData.postValue(
                            DressTryOnResultModel(
                                status = true,
                                message = "",
                                tryon_image = shareUrl,
                                result_id = resultId,
                            ),
                        )
                        return@launch
                    }
                    "FAILED", "CANCELLED" -> {
                        val errorCode = status.optString("errorCode", "TRYON_FAILED")
                        _error.postValue("Server error ($errorCode): the try-on could not be completed. Please try again.")
                        return@launch
                    }
                }
                delay(2000)
            }
        }
    }

    fun cancelTryonPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }
    suspend fun getTryonPhotoUrlSync(r2Key: String): String = repository.getTryonPhotoUrl(r2Key)
    fun getTryonJobStatusForResultScreen(jobId: String, callback: (liked: Boolean, inCart: Boolean) -> Unit) {
        viewModelScope.launch {
            runCatching { repository.getTryonJobStatus(jobId) }
                .onSuccess { status ->
                    callback(status.optBoolean("liked", false), status.optBoolean("inCart", false))
                }
                .onFailure { /* Non-fatal: leave the icons in their default state. */ }
        }
    }
    fun fetchVastraTryOnResultAPI(
        activity: Activity,
        garmentId: String,
        deviceId: String,
        promtId: String,
        imageId: String,
    ) {
        fetchDressTryOnAPI(activity, garmentId, deviceId)
    }

    fun showSnackErrorMsg(activity: Activity, erroMsg: String) {
        _error.postValue(erroMsg)
    }

    fun getQrCodeLinkAPI(activity: Activity) {
        viewModelScope.launch {
            runCatching {
                repository.createUploadSession()
            }.onSuccess { session ->
                _qrCodeLinkData.postValue(
                    QrCodeLinkDataModel(status = true, message = "", url = session.getString("qrUrl")),
                )
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }

    fun cancelQrScanPhotoFetchApiJob() {
        pollingJob?.cancel()
        pollingJob = null
    }
    fun startCheckOfUserImageUpload(token: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            _userOpenQrCodeLink.postValue(UploadImageModel(open = "no"))
            while (true) {
                val status = try {
                    repository.getUploadSessionStatus(token)
                } catch (cause: Throwable) {
                    val (title, message) = ApiErrorPresenter.present(cause)
                    if (cause is ApiException.BackendError && cause.code == "SESSION_EXPIRED") {
                        _uploadUserImageData.postValue(
                            UploadImageModel(
                                status = false,
                                message = "This QR code expired. Please try again.",
                                is_session_expired = true,
                            ),
                        )
                    } else {
                        _error.postValue("$title: $message")
                    }
                    return@launch
                }

                if (status.optString("status") == "uploaded") {
                    _userOpenQrCodeLink.postValue(UploadImageModel(open = "yes"))
                    val r2Key = status.getString("r2Key")
                    _uploadedPhotoR2Key.postValue(r2Key)
                    PrefsManager.saveUploadedPhotoR2Key(r2Key)
                    _uploadUserImageData.postValue(
                        UploadImageModel(
                            status = true,
                            message = "",
                            id = r2Key,
                            garment_id = r2Key,
                            imagePath = r2Key,
                        ),
                    )
                    return@launch
                }
                delay(3000)
            }
        }
    }
    fun likeVastraTryOnResultAPI(resultId: String, likeStatus: String) {
        viewModelScope.launch {
            runCatching {
                repository.setTryonResultLiked(resultId, likeStatus == "1")
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }

    fun addToCartVastraTryOnResultAPI(resultId: String, cardStatus: String) {
        viewModelScope.launch {
            runCatching {
                repository.setTryonResultInCart(resultId, cardStatus == "1")
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }
    fun deleteAllTryOnResultAPI(userImageId: String, deviceId: String, responseCallback: (Boolean, String) -> Unit) {
        repository.clearTryOnResults(userImageId)
        responseCallback(true, "Try-on results cleared")
    }

    fun uploadCaptureImageAPI(activity: Activity, imgFile: File) {
        viewModelScope.launch {
            runCatching {
                val contentType = "image/jpeg"
                val presign = repository.presignTryonPhoto(contentType, imgFile.length())
                val uploadUrl = presign.getString("uploadUrl")
                val r2Key = presign.getString("r2Key")
                uploadFileToR2(uploadUrl, imgFile, contentType)
                r2Key
            }.onSuccess { r2Key ->
                _uploadedPhotoR2Key.postValue(r2Key)
                val id = "photo-${System.currentTimeMillis()}"
                _uploadUserImageData.postValue(
                    UploadImageModel(
                        status = true,
                        message = "",
                        id = id,
                        garment_id = id,
                        imagePath = imgFile.absolutePath,
                    ),
                )
                PrefsManager.saveImageId(activity, id)
                PrefsManager.saveCapturedImage(activity, imgFile.absolutePath)
                PrefsManager.saveUploadedPhotoR2Key(r2Key)
            }.onFailure { cause ->
                val (title, message) = ApiErrorPresenter.present(cause)
                _error.postValue("$title: $message")
            }
        }
    }

    private suspend fun uploadFileToR2(uploadUrl: String, file: File, contentType: String) {
        withContext(Dispatchers.IO) {
            val client = okhttp3.OkHttpClient()
            val body = file.asRequestBody(contentType.toMediaType())
            val request = okhttp3.Request.Builder().url(uploadUrl).put(body).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException.NetworkError(IOException("Upload failed with HTTP ${response.code}"))
                }
            }
        }
    }
    fun userAppLoginAPI(email: String, password: String, deviceId: String) {
        viewModelScope.launch {
            runCatching {
                repository.loginDevice(email, password, deviceId)
            }.onSuccess { model ->
                PrefsManager.saveLoginUserData(model)
                _userLoginData.postValue(model)
            }.onFailure { cause ->
                if (cause is DeviceLimitReachedException && cause.forceLogoutToken.isNotBlank()) {
                    _deviceLimitReached.postValue(DeviceLimitState(cause.message.orEmpty(), cause.forceLogoutToken))
                } else {
                    _error.postValue(authErrorMessage(cause))
                }
            }
        }
    }

    fun forceLogoutOtherDeviceAndLogin(forceLogoutToken: String, deviceId: String) {
        viewModelScope.launch {
            runCatching {
                repository.forceLoginDevice(forceLogoutToken, deviceId)
            }.onSuccess { model ->
                PrefsManager.saveLoginUserData(model)
                _deviceLimitReached.postValue(null)
                _userLoginData.postValue(model)
            }.onFailure { cause ->
                _error.postValue(authErrorMessage(cause))
            }
        }
    }

    private fun authErrorMessage(cause: Throwable): String {
        val raw = cause.message.orEmpty()
        if (raw.contains("INVALID", ignoreCase = true) || raw.contains("invalid credentials", ignoreCase = true)) {
            return "Invalid email or password"
        }
        if (raw.contains("EMAIL_NOT_VERIFIED", ignoreCase = true)) {
            return "Please verify this email before logging in"
        }
        if (raw.contains("HTTP", ignoreCase = true)) {
            return "Unable to login. Please try again."
        }
        return raw.ifBlank { APIConstant.errorSomethingWrong }
    }

    fun userVerifyApi(deviceId: String) {
        _userLoginData.postValue(PrefsManager.loginUserInfo)
    }

    fun userLogoutAPI(deviceId: String, onSuccessCallBack: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            runCatching {
                repository.logoutDevice()
            }.onSuccess {
                PrefsManager.deleteuser()
                onSuccessCallBack(true, "")
            }.onFailure { cause ->
                onSuccessCallBack(false, authErrorMessage(cause))
            }
        }
    }

    fun getSelectedCatItem() {
        _selectedCatItem.postValue(repository.getSelectedSareeCatData())
    }

    fun getSelectedDressType() {
        _selectedDressType.postValue(repository.getSelectedDressTypeData())
    }

    fun getAllCatList() {
        _allSareeCategory.postValue(repository.getAllSareeCatData())
    }

    fun getDressesForList() {
        _dressesForData.postValue(repository.getDressesForData())
    }

    fun getSessionMessage() {
        _showTryOnSessionMsg.postValue(repository.getSessionMessage())
    }

    fun getDressesTypeList() {
        _dressesTypeData.postValue(repository.getDressesTypeData())
    }

    fun setAllCatList(list: ArrayList<SareeCateDataModel.Data>) {
        _allSareeCategory.value = list
    }

    fun setSelectedCatItem(selectedItem: SareeCateDataModel.Data) {
        _selectedCatItem.value = selectedItem
    }
}
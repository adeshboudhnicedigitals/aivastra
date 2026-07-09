package aivastra.nice.interactive.viewmodel.category

import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Dress.CommonResponseModel
import aivastra.nice.interactive.viewmodel.Dress.DressTryOnResultModel
import aivastra.nice.interactive.viewmodel.Dress.DressesForDataModel
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.Dress.UsetTryOnResultDataModel
import aivastra.nice.interactive.viewmodel.Login.UserLoginDataModel
import aivastra.nice.interactive.viewmodel.Qrcode.QrCodeLinkDataModel
import aivastra.nice.interactive.viewmodel.others.UploadImageModel
import android.app.Activity
import android.provider.Settings
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File

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
        val model = repository.getLocalDressesTypeData(cType)
        _dressesTypeData.postValue(model.data)
        repository.savDressesTypeData(model.data)
        _showTryOnSessionMsg.postValue(model.message)
    }

    fun filterProductBySKUNumber(searchBy: String) {
        if (repository.getDressesTypeData().isEmpty()) {
            repository.getLocalDressesTypeData("")
        }
        val results = repository.filterLocalProducts(searchBy)
        if (results.isEmpty()) {
            _error.postValue("No product found")
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
        _error.postValue(null)
    }

    fun fetchDressTryOnAPI(activity: Activity, garmentId: String, deviceId: String) {
        viewModelScope.launch {
            val imagePath = PrefsManager.getCapturedImage(activity)
            if (imagePath.isBlank()) {
                _error.postValue("Capture or upload a photo to preview this UI flow.")
                return@launch
            }

            val resultId = "ui-preview-${System.currentTimeMillis()}"
            repository.saveTryOnResult(
                UsetTryOnResultDataModel.Data(
                    wixuser = deviceId,
                    garment_id = garmentId,
                    userimage_id = PrefsManager.getImageID(activity).ifBlank { resultId },
                    upload_image_path = imagePath,
                    tryon_result_path = imagePath,
                    promt_id = resultId,
                    action_from = "ui-preview",
                    id = resultId,
                ),
            )
            _dressTryOnResultData.postValue(
                DressTryOnResultModel(
                    status = true,
                    message = "UI preview result",
                    tryon_image = imagePath,
                    result_id = resultId,
                ),
            )
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
        _qrCodeLinkData.postValue(
            QrCodeLinkDataModel(
                status = false,
                message = "QR upload is disabled while backend integration is removed.",
                url = "",
            ),
        )
    }

    fun cancelQrScanPhotoFetchApiJob() {
        pollingJob?.cancel()
        pollingJob = null
    }

    fun startCheckOfUserImageUpload(securityCode: String) {
        _userOpenQrCodeLink.postValue(
            UploadImageModel(
                status = false,
                message = "QR upload is disabled while backend integration is removed.",
                is_session_expired = true,
            ),
        )
    }

    fun checkUserUploadImageAPI(securityCode: String, apiResponseCallback: (UploadImageModel) -> Unit) {
        apiResponseCallback(
            UploadImageModel(
                status = false,
                message = "QR upload is disabled while backend integration is removed.",
                is_session_expired = true,
            ),
        )
    }

    fun likeVastraTryOnResultAPI(resultId: String, likeStatus: String) {
        _error.postValue(null)
    }

    fun addToCartVastraTryOnResultAPI(resultId: String, cardStatus: String) {
        _error.postValue(null)
    }

    fun deleteAllTryOnResultAPI(userImageId: String, deviceId: String, responseCallback: (Boolean, String) -> Unit) {
        repository.clearTryOnResults(userImageId)
        responseCallback(true, "Try-on UI preview data cleared")
    }

    fun uploadCaptureImageAPI(activity: Activity, imgFile: File) {
        val id = "ui-photo-${System.currentTimeMillis()}"
        val model = UploadImageModel(
            status = true,
            message = "Photo stored locally for UI preview",
            id = id,
            userId = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID).orEmpty(),
            garment_id = id,
            imagePath = imgFile.absolutePath,
        )
        _uploadUserImageData.postValue(model)
        PrefsManager.saveImageId(activity, id)
        PrefsManager.saveCapturedImage(activity, imgFile.absolutePath)
        repository.saveUploadedImageData(model)
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
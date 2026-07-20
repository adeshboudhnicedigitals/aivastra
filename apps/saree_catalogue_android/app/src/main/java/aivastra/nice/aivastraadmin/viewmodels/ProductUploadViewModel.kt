package aivastra.nice.aivastraadmin.viewmodels

import aivastra.nice.aivastraadmin.utils.PrefsManager
import aivastra.nice.aivastraadmin.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Login.UserSession
import android.app.Activity
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.facewixlatest.ApiUtils.APICaller
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody.Part.Companion.createFormData
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

class ProductUploadViewModel:ViewModel() {

    val repository = ProductUploadDataRepository
    private val maxTryOnPollAttempts = 80
    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> get() = _error

    private val _uploadProductData = MutableLiveData<VastraTryOnResultModel>()
    val uploadProductImageData: LiveData<VastraTryOnResultModel> get() = _uploadProductData

    private val _addCustomProductData = MutableLiveData<CommonResponseModel>()
    val addCustomProductData: LiveData<CommonResponseModel> get() = _addCustomProductData

    private val _productCategoryDataList = MutableLiveData<ArrayList<ProductCategoryDataModel.Data>>()
    val productCategoryDataList: LiveData<ArrayList<ProductCategoryDataModel.Data>> get() = _productCategoryDataList

    val searchResultEvent = MutableLiveData<SearchEvent<ArrayList<VastraProductCategoryDataModel.Data.Subcategory.Item>>>()

    private val _searchProductData = MutableLiveData<ArrayList<VastraProductCategoryDataModel.Data.Subcategory.Item>>()
    val searchProductData: LiveData<ArrayList<VastraProductCategoryDataModel.Data.Subcategory.Item>> get() = _searchProductData

    private val _allAddedProductCategoryData = MutableLiveData<ArrayList<VastraProductCategoryDataModel.Data>>()
    val allAddedProductCategoryData: LiveData<ArrayList<VastraProductCategoryDataModel.Data>> get() = _allAddedProductCategoryData

    private val _sareePalluTypeData = MutableLiveData<ArrayList<SareePalluTypeDataModel.Data>>()
    val sareePalluTypeData: LiveData<ArrayList<SareePalluTypeDataModel.Data>> get() = _sareePalluTypeData

    private val _sessionResult = MutableLiveData<UserSession?>()
    val sessionResult: LiveData<UserSession?> get() = _sessionResult

    fun resetProductCatList() {
        _productCategoryDataList.postValue(arrayListOf())  // Clear the previous value before calling API
        _error.postValue(null)  // Clear the previous value before calling API
    }

    fun resetAddCustomProductData() {
        _addCustomProductData.postValue(null)  // Clear the previous value before calling API
        _error.postValue(null)  // Clear the previous value before calling API
    }

    fun resetPalluTypeList() {
        _sareePalluTypeData.postValue(arrayListOf())  // Clear the previous value before calling API
        _error.postValue(null)  // Clear the previous value before calling API
    }

    fun resetError() {
        _error.postValue(null)
    }


    fun fetchSareeCategoryData() {
        viewModelScope.launch {
            try {
                repository.getProductAllCategoryAPI(object : APICaller.APICallBack{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as ProductCategoryDataModel
                        if (getModelClass.status==false) {
                            _error.postValue(getModelClass.message)
                            return null
                        }
                        _productCategoryDataList.value = getModelClass.data
                        return null
                    }

                    override fun onFailure() {
                        _error.postValue("Error: ${APIConstant.errorSomethingWrong}")
                    }
                })
            } catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
    }

    fun fetchSareePalluTypeData() {
        viewModelScope.launch {
            try {
                repository.getSareePalluTypeListAPI(object : APICaller.APICallBack{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as SareePalluTypeDataModel
                        if (getModelClass.status==false) {
                            _error.postValue(getModelClass.message)
                            return null
                        }
                        _sareePalluTypeData.value = getModelClass.data
                        return null
                    }

                    override fun onFailure() {
                        _error.postValue("Error: ${APIConstant.errorSomethingWrong}")
                    }
                })
            } catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
    }

    fun fetchAllUploadedProductCategoryWiseData() {
        viewModelScope.launch {
            try {
                repository.getAllUploadedProductCategoryListAPI(object : APICaller.APICallBack{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as VastraProductCategoryDataModel
                        if (getModelClass.status==false) {
                            _error.postValue(getModelClass.message)
                            return null
                        }
                        _allAddedProductCategoryData.value = getModelClass.data
                        return null
                    }

                    override fun onFailure() {
                        _error.postValue("Error: ${APIConstant.errorSomethingWrong}")
                    }
                })
            } catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
    }

    fun fetchCustomSareeTryOnAPI(activity: Activity,imgFile: File,palluType:String) {
        viewModelScope.launch {
            try {
                val deviceId = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID)
                val requestBody = imgFile.asRequestBody("image".toMediaTypeOrNull())
                val imageMultiPart = requestBody.let {
                    createFormData("userfile", imgFile.name, it)
                }
                val hashMapData : HashMap<String, RequestBody> = HashMap<String, RequestBody> ()
                hashMapData.put(APIConstant.Parameter.WIX_USER,ViewControll.convertStringToRequestBody(deviceId))
                hashMapData.put(APIConstant.Parameter.PALLU_TYPE,ViewControll.convertStringToRequestBody(palluType))
                hashMapData.put(APIConstant.Parameter.USER_ID,ViewControll.convertStringToRequestBody(PrefsManager.loginUserInfo.user.id))
                hashMapData.put(APIConstant.Parameter.THEMES_FOR, ViewControll.convertStringToRequestBody("women"))
                hashMapData.put(APIConstant.Parameter.DRESS_TYPE,ViewControll.convertStringToRequestBody("Saree"))
                repository.uploadVastraProductPhotoAPI(hashMapData,imageMultiPart,object : APICaller.APICallBack{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as VastraTryOnResultModel
                        if (getModelClass.status==false) {
                            if (getModelClass.still_processing && getModelClass.retryable) {
                                pollTryOnResult(getModelClass, 1)
                                return null
                            }
                            _error.postValue(getModelClass.message)
                            return null
                        }
                        if (getModelClass.tryon_image.isEmpty()) {
                            _error.postValue(APIConstant.fileNotSupported)
                            return null
                        }
                        _uploadProductData.value = getModelClass
                        return null
                    }

                    override fun onFailure() {
                        _error.postValue(APIConstant.serverTimeOut)
                    }
                })
            } catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
    }

    private fun pollTryOnResult(processingModel: VastraTryOnResultModel, attempt: Int) {
        val resultId = processingModel.result_id
        val promtId = processingModel.promt_id.ifEmpty { processingModel.promt_data.promt_id }
        if (resultId.isEmpty() || promtId.isEmpty()) {
            _error.postValue(APIConstant.errorSomethingWrong)
            return
        }
        if (attempt > maxTryOnPollAttempts) {
            _error.postValue(APIConstant.serverTimeOut)
            return
        }
        val retryDelayMs = when {
            processingModel.retry_after_ms > 0 -> processingModel.retry_after_ms.toLong()
            processingModel.wait_seconds > 0 -> processingModel.wait_seconds * 1000L
            else -> 2500L
        }

        viewModelScope.launch {
            delay(retryDelayMs)
            val hashMapData : HashMap<String?, RequestBody?> = HashMap<String?, RequestBody?>()
            hashMapData.put(APIConstant.Parameter.RESULT_ID, ViewControll.convertStringToRequestBody(resultId))
            hashMapData.put(APIConstant.Parameter.PROMT_ID, ViewControll.convertStringToRequestBody(promtId))
            repository.getTryOnResultAPI(hashMapData, object : APICaller.APICallBackWithError {
                override fun <T> onSuccess(modelclass: T): Class<T>? {
                    val resultModel = modelclass as VastraTryOnResultModel
                    if (resultModel.status == false) {
                        if (resultModel.still_processing && resultModel.retryable) {
                            pollTryOnResult(
                                resultModel.copy(
                                    result_id = resultModel.result_id.ifEmpty { resultId },
                                    promt_id = resultModel.promt_id.ifEmpty { promtId }
                                ),
                                attempt + 1
                            )
                            return null
                        }
                        _error.postValue(resultModel.message.ifEmpty { APIConstant.errorSomethingWrong })
                        return null
                    }
                    if (resultModel.tryon_image.isEmpty()) {
                        _error.postValue(APIConstant.fileNotSupported)
                        return null
                    }
                    _uploadProductData.postValue(resultModel)
                    return null
                }

                override fun onFailure(errorMsg: String) {
                    _error.postValue(errorMsg.ifEmpty { APIConstant.serverTimeOut })
                }
            })
        }
    }

    fun uploadCustomProductAPI(activity: Activity,result_id:String,story_id:String,skuNo:String,
                               price:String,offerPrice:String) {
        viewModelScope.launch {
            try {
                val deviceId = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID)
                val hashMapData : HashMap<String?, RequestBody?> = HashMap<String?, RequestBody?> ()
                hashMapData.put(APIConstant.Parameter.WIX_USER,ViewControll.convertStringToRequestBody(deviceId))
                hashMapData.put(APIConstant.Parameter.USER_ID,ViewControll.convertStringToRequestBody(PrefsManager.loginUserInfo.user.id))
                hashMapData.put(APIConstant.Parameter.MERCHANT_ID, ViewControll.convertStringToRequestBody(PrefsManager.loginUserInfo.user.addedOn))
                hashMapData.put(APIConstant.Parameter.RESULT_ID,ViewControll.convertStringToRequestBody(result_id))
                hashMapData.put(APIConstant.Parameter.STORY_ID,ViewControll.convertStringToRequestBody(story_id))
                hashMapData.put(APIConstant.Parameter.SKU_NO,ViewControll.convertStringToRequestBody(skuNo))
                hashMapData.put(APIConstant.Parameter.PRICE,ViewControll.convertStringToRequestBody(price))
                hashMapData.put(APIConstant.Parameter.OFFER_PRICE,ViewControll.convertStringToRequestBody(offerPrice))
                repository.uploadCustomVastraProductAPI(hashMapData,object : APICaller.APICallBackWithError{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as CommonResponseModel
                        if (getModelClass.status==false) {
                            _error.postValue(getModelClass.message)
                            return null
                        }
                        _addCustomProductData.value = getModelClass
                        return null
                    }

                    override fun onFailure(errorMsg: String) {
                        _error.postValue(errorMsg)
                    }
                })
            }catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
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
    fun filterProductBySKUNumber(searchBy:String) {
        viewModelScope.launch {
            try {
                val hashMapData : HashMap<String?, RequestBody?> = HashMap<String?, RequestBody?> ()
                hashMapData.put(APIConstant.Parameter.USER_ID,ViewControll.convertStringToRequestBody(PrefsManager.loginUserInfo.user.addedOn))
                hashMapData.put(APIConstant.Parameter.SKU_NUMBER, ViewControll.convertStringToRequestBody(searchBy))
                repository.filterProductBySKUNo(hashMapData,object : APICaller.APICallBackWithError{
                    override fun <T> onSuccess(modelclass: T): Class<T>? {
                        val getModelClass = modelclass as ProductSearchDataModel
                        if(getModelClass.status==false){
                            _error.postValue("No product found")
                            return null
                        }
                        searchResultEvent.value = SearchEvent(getModelClass.data)
                        return null
                    }

                    override fun onFailure(errorMsg: String) {
                        _error.postValue("Error: $errorMsg")
                    }
                })
            } catch (e: Exception) {
                _error.postValue("Error: ${e.message}")
            }
        }
    }

}

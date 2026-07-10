package aivastra.nice.interactive.viewmodel.category

import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.viewmodel.Dress.DressesForDataModel
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.Dress.UsetTryOnResultDataModel
import aivastra.nice.interactive.viewmodel.Login.UserLoginDataModel
import aivastra.nice.interactive.viewmodel.others.UploadImageModel
import android.os.Build
import com.example.facewixlatest.ApiUtils.APICaller
import com.example.facewixlatest.ApiUtils.APIConstant
import org.json.JSONObject
import java.util.Locale

class DeviceLimitReachedException(
    message: String,
    val forceLogoutToken: String,
) : Exception(message)

object SareeCategoryDataRepository {

    private var sareeCatData: SareeCateDataModel.Data = SareeCateDataModel.Data()
    private var selectedDressType: DressesTypeDataModel.Data = DressesTypeDataModel.Data()
    private var uploadedImageData: UploadImageModel = UploadImageModel()
    private var allcategoryList: ArrayList<SareeCateDataModel.Data> = arrayListOf()
    private var dressesForDataList: ArrayList<DressesForDataModel.Data> = arrayListOf()
    private var dressesTypeDataList: ArrayList<DressesTypeDataModel.Data> = arrayListOf()
    private var tryOnResults: ArrayList<UsetTryOnResultDataModel.Data> = arrayListOf()
    var startAutoTryOnProcess = false
    var isFromCameraSetting = false
    private var tryOnSessionMessage: String = "Backend is disconnected. UI preview mode is active."


    suspend fun loginDevice(email: String, password: String, androidId: String): UserLoginDataModel {
        val payload = JSONObject().apply {
            put("email", email.trim())
            put("password", password)
            put("deviceId", androidId)
            put("deviceName", deviceName())
            put("platform", "kiosk")
        }
        return postDeviceLogin(APIConstant.API_ENDPOINTS.DEVICE_LOGIN, payload)
    }

    suspend fun forceLoginDevice(forceLogoutToken: String, androidId: String): UserLoginDataModel {
        val payload = JSONObject().apply {
            put("forceLogoutToken", forceLogoutToken)
            put("deviceId", androidId)
            put("deviceName", deviceName())
            put("platform", "kiosk")
        }
        return postDeviceLogin(APIConstant.API_ENDPOINTS.DEVICE_LOGIN_FORCE, payload)
    }

    private suspend fun postDeviceLogin(endpoint: String, payload: JSONObject): UserLoginDataModel {
        val responseText = try {
            APICaller.postJson(endpoint, payload.toString())
        } catch (cause: Throwable) {
            throw parseLoginError(cause)
        }
        val response = JSONObject(responseText)
        val accessToken = response.optString("accessToken", "")
        val refreshToken = response.optString("refreshToken", "")
        if (accessToken.isBlank() || refreshToken.isBlank()) {
            throw IllegalStateException(APIConstant.errorSomethingWrong)
        }
        val user = response.optJSONObject("user") ?: JSONObject()
        PrefsManager.saveRefreshToken(refreshToken)
        return UserLoginDataModel(
            status = true,
            message = "Login successful",
            user = UserLoginDataModel.User(
                id = user.optString("id", androidIdFromPayload(payload)),
                username = user.optString("email", payload.optString("email", "")),
                name = user.optString("displayName", user.optString("email", "AiVastra user")),
                email = user.optString("email", payload.optString("email", "")),
                addedOn = "kiosk",
                merchantBname = user.optString("tier", "AiVastra"),
                apiKey = accessToken,
                deviceId = payload.optString("deviceId", ""),
            ),
        )
    }

    private fun parseLoginError(cause: Throwable): Throwable {
        val raw = cause.message.orEmpty()
        return try {
            val error = JSONObject(raw).optJSONObject("error") ?: return cause
            if (error.optString("code") == "DEVICE_LIMIT_REACHED") {
                DeviceLimitReachedException(
                    error.optString("message", "This account is already active on another device."),
                    error.optString("forceLogoutToken", ""),
                )
            } else {
                cause
            }
        } catch (_: Exception) {
            cause
        }
    }

    private fun deviceName(): String {
        return listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { "Android kiosk" }
    }

    private fun androidIdFromPayload(payload: JSONObject): String = payload.optString("deviceId", "")


    suspend fun logoutDevice() {
        val refreshToken = PrefsManager.getRefreshToken()
        if (refreshToken.isBlank()) return
        val payload = JSONObject().apply {
            put("refreshToken", refreshToken)
        }
        APICaller.postJson(APIConstant.API_ENDPOINTS.DEVICE_LOGOUT, payload.toString())
    }
    fun getLocalDressesForData(): DressesForDataModel {
        if (dressesForDataList.isEmpty()) {
            dressesForDataList = arrayListOf(
                DressesForDataModel.Data(title = AppConstant.WOMEN, ctype = AppConstant.WOMEN),
                DressesForDataModel.Data(title = AppConstant.MEN, ctype = AppConstant.MEN),
                DressesForDataModel.Data(title = AppConstant.GIRL, ctype = AppConstant.GIRL),
                DressesForDataModel.Data(title = AppConstant.BOY, ctype = AppConstant.BOY),
            )
        }
        return DressesForDataModel(
            data = ArrayList(dressesForDataList),
            status = true,
            message = tryOnSessionMessage,
        )
    }

    fun getLocalDressesTypeData(cType: String): DressesTypeDataModel {
        val normalizedType = cType.ifBlank { AppConstant.WOMEN }
        val displayName = normalizedType.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
        }
        val items = arrayListOf(
            DressesTypeDataModel.Data.Subcategory.Item(
                id = "preview-1-$normalizedType",
                garmentid = "preview-1-$normalizedType",
                name = "$displayName Preview Look 1",
                orginalName = "$displayName Preview Look 1",
                dressFor = normalizedType,
                dressType = "Preview",
                dressName = displayName,
                categoryname = "Preview",
                sku_number = "PREVIEW-001",
            ),
            DressesTypeDataModel.Data.Subcategory.Item(
                id = "preview-2-$normalizedType",
                garmentid = "preview-2-$normalizedType",
                name = "$displayName Preview Look 2",
                orginalName = "$displayName Preview Look 2",
                dressFor = normalizedType,
                dressType = "Preview",
                dressName = displayName,
                categoryname = "Preview",
                sku_number = "PREVIEW-002",
            ),
        )
        dressesTypeDataList = arrayListOf(
            DressesTypeDataModel.Data(
                id = normalizedType,
                dressFor = normalizedType,
                dressName = displayName,
                categoryname = displayName,
                subcategory = arrayListOf(
                    DressesTypeDataModel.Data.Subcategory(
                        name = "Preview",
                        items = items,
                    ),
                ),
            ),
        )
        return DressesTypeDataModel(
            status = true,
            message = tryOnSessionMessage,
            data = ArrayList(dressesTypeDataList),
        )
    }

    fun filterLocalProducts(searchBy: String): ArrayList<DressesTypeDataModel.Data.Subcategory.Item> {
        val query = searchBy.trim().lowercase(Locale.getDefault())
        val items = dressesTypeDataList.flatMap { type -> type.subcategory.flatMap { it.items } }
        if (query.isBlank()) return ArrayList(items)
        return ArrayList(
            items.filter { item ->
                item.name.lowercase(Locale.getDefault()).contains(query) ||
                    item.sku_number.lowercase(Locale.getDefault()).contains(query)
            },
        )
    }

    fun saveTryOnResult(result: UsetTryOnResultDataModel.Data) {
        tryOnResults.removeAll { it.id == result.id }
        tryOnResults.add(0, result)
    }

    fun getTryOnResults(tryOnResultId: String): ArrayList<UsetTryOnResultDataModel.Data> {
        if (tryOnResultId.isBlank()) return ArrayList(tryOnResults)
        return ArrayList(tryOnResults.filter { it.userimage_id == tryOnResultId || it.id == tryOnResultId })
    }

    fun clearTryOnResults(userImageId: String) {
        tryOnResults = if (userImageId.isBlank()) {
            arrayListOf()
        } else {
            ArrayList(tryOnResults.filterNot { it.userimage_id == userImageId })
        }
    }

    fun setSelectedSareeCatData(selectedCatData: SareeCateDataModel.Data) {
        sareeCatData = selectedCatData
    }

    fun getSelectedSareeCatData(): SareeCateDataModel.Data {
        return sareeCatData
    }

    fun setSelectedDressTypeData(selectedType: DressesTypeDataModel.Data) {
        selectedDressType = selectedType
    }

    fun getSelectedDressTypeData(): DressesTypeDataModel.Data {
        return selectedDressType
    }

    fun saveUploadedImageData(imageData: UploadImageModel) {
        uploadedImageData = imageData
    }

    fun getUploadedImageData(): UploadImageModel {
        return uploadedImageData
    }

    fun saveAllSareeCatData(allCatDataList: ArrayList<SareeCateDataModel.Data>) {
        allcategoryList = allCatDataList
    }

    fun savDressesForData(dressesForList: ArrayList<DressesForDataModel.Data>) {
        dressesForDataList = dressesForList
    }

    fun getDressesForData(): ArrayList<DressesForDataModel.Data> {
        return dressesForDataList
    }

    fun saveSessionMessage(message: String) {
        tryOnSessionMessage = message
    }

    fun getSessionMessage(): String {
        return tryOnSessionMessage
    }

    fun savDressesTypeData(dressesTypeList: ArrayList<DressesTypeDataModel.Data>) {
        dressesTypeDataList = dressesTypeList
    }

    fun getDressesTypeData(): ArrayList<DressesTypeDataModel.Data> {
        return dressesTypeDataList
    }

    fun getAllSareeCatData(): ArrayList<SareeCateDataModel.Data> {
        return allcategoryList
    }
}
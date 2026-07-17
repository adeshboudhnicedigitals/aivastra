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
    private var tryOnSessionMessage: String = ""


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
        val raw = (cause as? com.example.facewixlatest.ApiUtils.ApiException.BackendError)?.rawBody
            ?: cause.message.orEmpty()
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
    suspend fun fetchMerchantCatalogTypeData(cType: String): DressesTypeDataModel {
        val category = cType.lowercase()
        val subcategoriesJson = APICaller.getJsonAuthed(
            "${APIConstant.API_ENDPOINTS.MERCHANT_CATALOG_SUBCATEGORIES}?category=$category",
            PrefsManager.getAccessToken(),
        )
        val subcategoryItems = JSONObject(subcategoriesJson).getJSONArray("items")
        val subcategoryIds = ArrayList<String>()
        val subcategories = ArrayList<DressesTypeDataModel.Data.Subcategory>().apply {
            for (i in 0 until subcategoryItems.length()) {
                val row = subcategoryItems.getJSONObject(i)
                subcategoryIds.add(row.getString("id"))
                add(DressesTypeDataModel.Data.Subcategory())
            }
        }

        val allItemsJson = APICaller.getJsonAuthed(
            APIConstant.API_ENDPOINTS.MERCHANT_CATALOG_ITEMS,
            PrefsManager.getAccessToken(),
        )
        val allItems = JSONObject(allItemsJson).getJSONArray("items")
        val itemsBySubcategory = HashMap<String, ArrayList<DressesTypeDataModel.Data.Subcategory.Item>>()
        for (i in 0 until allItems.length()) {
            val row = allItems.getJSONObject(i)
            val subcategoryId = row.getString("subcategoryId")
            if (!subcategoryIds.contains(subcategoryId)) continue
            val item = DressesTypeDataModel.Data.Subcategory.Item().apply {
                id = row.getString("id")
                garmentid = row.getString("id")
                name = row.getString("label")
                orginalName = row.getString("label")
                dressFor = category
                fullpath = row.optString("imageUrl", "")
                preview = row.optString("thumbnailUrl", "")
                price = row.optInt("actualPrice", 0).toString()
                offerprice = row.optInt("offerPrice", 0).toString()
                sku_number = row.optString("sku", "")
            }
            itemsBySubcategory.getOrPut(subcategoryId) { arrayListOf() }.add(item)
        }

        for (i in 0 until subcategoryItems.length()) {
            val row = subcategoryItems.getJSONObject(i)
            val subcategoryId = row.getString("id")
            subcategories[i] = DressesTypeDataModel.Data.Subcategory().apply {
                name = row.getString("name")
                items = itemsBySubcategory[subcategoryId] ?: arrayListOf()
            }
        }

        val data = DressesTypeDataModel.Data(
            id = category,
            dressFor = category,
            dressName = category,
            categoryname = category,
            subcategory = subcategories,
        )
        dressesTypeDataList = arrayListOf(data)
        return DressesTypeDataModel(status = true, message = "", data = arrayListOf(data))
    }

    suspend fun presignTryonPhoto(contentType: String, contentLength: Long): JSONObject {
        val payload = JSONObject().apply {
            put("contentType", contentType)
            put("contentLength", contentLength)
        }
        val responseText = APICaller.postJsonAuthed(
            APIConstant.API_ENDPOINTS.MERCHANT_TRYON_PRESIGN,
            payload.toString(),
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText)
    }

    suspend fun getTryonPhotoUrl(r2Key: String): String {
        val encoded = java.net.URLEncoder.encode(r2Key, "UTF-8")
        val responseText = APICaller.getJsonAuthed(
            "v1/merchant/tryon/photo-url?r2Key=$encoded",
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText).getString("url")
    }
    suspend fun createTryonJob(merchantCatalogItemId: String, customerPhotoKey: String): String {
        val payload = JSONObject().apply {
            put("merchantCatalogItemId", merchantCatalogItemId)
            put("customerPhotoKey", customerPhotoKey)
        }
        val responseText = APICaller.postJsonAuthed(
            APIConstant.API_ENDPOINTS.MERCHANT_TRYON_JOBS,
            payload.toString(),
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText).getString("jobId")
    }

    suspend fun getTryonJobStatus(jobId: String): JSONObject {
        val responseText = APICaller.getJsonAuthed(
            APIConstant.API_ENDPOINTS.merchantTryonJob(jobId),
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText)
    }

    suspend fun cancelTryonJob(jobId: String) {
        APICaller.deleteAuthed(
            APIConstant.API_ENDPOINTS.merchantTryonJob(jobId),
            PrefsManager.getAccessToken(),
        )
    }

    suspend fun setTryonResultLiked(jobId: String, liked: Boolean) {
        val url = APIConstant.API_ENDPOINTS.merchantTryonJobLike(jobId)
        if (liked) {
            APICaller.putJsonAuthed(url, PrefsManager.getAccessToken())
        } else {
            APICaller.deleteAuthed(url, PrefsManager.getAccessToken())
        }
    }

    suspend fun setTryonResultInCart(jobId: String, inCart: Boolean) {
        val url = APIConstant.API_ENDPOINTS.merchantTryonJobCart(jobId)
        if (inCart) {
            APICaller.putJsonAuthed(url, PrefsManager.getAccessToken())
        } else {
            APICaller.deleteAuthed(url, PrefsManager.getAccessToken())
        }
    }

    suspend fun createUploadSession(): JSONObject {
        val responseText = APICaller.postJsonAuthed(
            APIConstant.API_ENDPOINTS.MERCHANT_UPLOAD_SESSIONS,
            "",
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText)
    }

    suspend fun getUploadSessionStatus(token: String): JSONObject {
        val responseText = APICaller.getJsonAuthed(
            APIConstant.API_ENDPOINTS.merchantUploadSessionStatus(token),
            PrefsManager.getAccessToken(),
        )
        return JSONObject(responseText)
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
        return DressesForDataModel(data = ArrayList(dressesForDataList), status = true, message = "")
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

    fun setSelectedSareeCatData(selectedCatData: SareeCateDataModel.Data) { sareeCatData = selectedCatData }
    fun getSelectedSareeCatData(): SareeCateDataModel.Data = sareeCatData
    fun setSelectedDressTypeData(selectedType: DressesTypeDataModel.Data) { selectedDressType = selectedType }
    fun getSelectedDressTypeData(): DressesTypeDataModel.Data = selectedDressType
    fun saveUploadedImageData(imageData: UploadImageModel) { uploadedImageData = imageData }
    fun getUploadedImageData(): UploadImageModel = uploadedImageData
    fun saveAllSareeCatData(allCatDataList: ArrayList<SareeCateDataModel.Data>) { allcategoryList = allCatDataList }
    fun savDressesForData(dressesForList: ArrayList<DressesForDataModel.Data>) { dressesForDataList = dressesForList }
    fun getDressesForData(): ArrayList<DressesForDataModel.Data> = dressesForDataList
    fun saveSessionMessage(message: String) { tryOnSessionMessage = message }
    fun getSessionMessage(): String = tryOnSessionMessage
    fun savDressesTypeData(dressesTypeList: ArrayList<DressesTypeDataModel.Data>) { dressesTypeDataList = dressesTypeList }
    fun getDressesTypeData(): ArrayList<DressesTypeDataModel.Data> = dressesTypeDataList
    fun getAllSareeCatData(): ArrayList<SareeCateDataModel.Data> = allcategoryList

    fun filterLocalProducts(searchBy: String): ArrayList<DressesTypeDataModel.Data.Subcategory.Item> {
        val query = searchBy.trim().lowercase()
        val items = dressesTypeDataList.flatMap { type -> type.subcategory.flatMap { it.items } }
        if (query.isBlank()) return ArrayList(items)
        return ArrayList(
            items.filter { item ->
                item.name.lowercase().contains(query) || item.sku_number.lowercase().contains(query)
            },
        )
    }
}
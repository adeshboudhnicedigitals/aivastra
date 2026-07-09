package aivastra.nice.interactive.utils

import aivastra.nice.interactive.app.MyAPP
import aivastra.nice.interactive.viewmodel.Login.UserLoginDataModel
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.google.gson.Gson

object PrefsManager {
    private const val PREFS_NAME = "AiVastra"
    private const val SECURE_PREFS_NAME = "AiVastraSecure"
    private const val KEY_USER_ID = "USER_ID"
    private const val KEY_REFRESH_TOKEN = "REFRESH_TOKEN"
    private const val CAPTURED_IMAGE = "captured_image"
    const val KEY_FLASH = "flash"
     const val KEY_HDR = "hdr"
     const val KEY_WB = "white_balance"
     const val KEY_SUPPORTED_CAMERA = "supported_camera"
     const val KEY_ENGINE = "engine"
     const val KEY_PREVIEW = "preview"
     const val KEY_RESOLUTION = "resolution"
     const val KEY_PIC_WIDTH = "picture_width"
     const val KEY_PIC_HEIGHT = "picture_height"
     const val KEY_ORIENTATION = "orientation"
     const val SETTING_CHANGED = "settings_changed"

    private fun appPrefs(): SharedPreferences {
        return MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
    }

    private fun securePrefs(): SharedPreferences {
        val context = MyAPP.appContext!!
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedSharedPreferences.create(
            SECURE_PREFS_NAME,
            masterKeyAlias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun deleteuser() {
        synchronized(this) {
            appPrefs().edit().clear().apply()
            securePrefs().edit().clear().apply()
        }
    }


    fun clearKioskSession() {
        synchronized(this) {
            appPrefs().edit().remove("SaveLoginUserDetails").apply()
            clearRefreshToken()
        }
    }

    fun saveRefreshToken(refreshToken: String) {
        securePrefs().edit().putString(KEY_REFRESH_TOKEN, refreshToken).apply()
    }

    fun getRefreshToken(): String {
        return securePrefs().getString(KEY_REFRESH_TOKEN, "") ?: ""
    }

    fun clearRefreshToken() {
        securePrefs().edit().remove(KEY_REFRESH_TOKEN).apply()
    }

    fun getAccessToken(): String {
        return loginUserInfo.user.apiKey
    }

    fun updateAccessToken(accessToken: String) {
        val current = loginUserInfo
        current.user.apiKey = accessToken
        saveLoginUserData(current)
    }
    fun saveImageId(context: Context, userId: String) {
        val sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        sharedPreferences.edit().putString(KEY_USER_ID, userId).apply()
    }

    fun saveCapturedImage(context: Context, filePath: String) {
        val sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        sharedPreferences.edit().putString(CAPTURED_IMAGE, filePath).apply()
    }

    fun getCapturedImage(context: Context): String {
        val sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sharedPreferences.getString(CAPTURED_IMAGE, "")?: ""
    }

    fun getImageID(context: Context): String {
        val sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sharedPreferences.getString(KEY_USER_ID, "")?: ""
    }

    fun clearUserId(context: Context) {
        val sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        sharedPreferences.edit().remove(KEY_USER_ID).apply()
    }

    fun putString(key: String, value: String) {
        synchronized(this) {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            checkForNullKey(key)
            checkForNullValue(value)
            sharedPreferences.edit().putString(key, value).apply()
        }
    }

    fun getInt(key: String, defaultvalue: Int): Int {
        val sharedPreferences: SharedPreferences =
            MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
        return sharedPreferences.getInt(key, defaultvalue)
    }

    fun putInt(key: String, value: Int) {
        synchronized(this) {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            sharedPreferences.edit().putInt(key, value).apply()
        }
    }

    fun getFloat(key: String, defaultvalue: Float): Float {
        val sharedPreferences: SharedPreferences = MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
        return sharedPreferences.getFloat(key, defaultvalue)
    }

    fun putFloat(key: String, value: Float) {
        synchronized(this) {
            val sharedPreferences: SharedPreferences = MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            sharedPreferences.edit().putFloat(key, value).apply()
        }
    }

    fun getAppname(): String {
        return "FaceWix"
    }

    fun getString(key: String, defaultvalue: String): String? {
        val sharedPreferences: SharedPreferences =
            MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
        return sharedPreferences.getString(key, defaultvalue)
    }

    fun putBoolean(key: String, value: Boolean) {
        synchronized(this) {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            checkForNullKey(key)
            sharedPreferences.edit().putBoolean(key, value).apply()
        }
    }

    fun getBoolean(key: String): Boolean {
        val sharedPreferences: SharedPreferences =
            MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
        return sharedPreferences.getBoolean(key, false)
    }

    fun getBooleanTrue(key: String): Boolean {
        val sharedPreferences: SharedPreferences =
            MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
        return sharedPreferences.getBoolean(key, true)
    }

    fun saveLoginUserData(user: UserLoginDataModel) {
        synchronized(this) {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            val sharedPreferencesEditor = sharedPreferences.edit()
            val gson = Gson()
            val serializedObject: String = gson.toJson(user)
            sharedPreferencesEditor.putString("SaveLoginUserDetails", serializedObject)
            sharedPreferencesEditor.apply()
        }
    }

    val loginUserInfo: UserLoginDataModel
        get() {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(getAppname(), Context.MODE_PRIVATE)
            if (sharedPreferences.contains("SaveLoginUserDetails")) {
                val gson = Gson()
                return gson.fromJson(
                    sharedPreferences.getString("SaveLoginUserDetails", ""),
                    UserLoginDataModel::class.java
                )
            }
            return UserLoginDataModel()
        }

    val isUserExist: Boolean
        get() {
            val sharedPreferences: SharedPreferences =
                MyAPP.appContext!!.getSharedPreferences(
                    getAppname(),
                    Context.MODE_PRIVATE
                )
            return sharedPreferences.contains("SaveLoginUserDetails")
        }


    fun checkForNullKey(key: String?) {
        if (key == null) {
            throw NullPointerException()
        }
    }


    fun checkForNullValue(value: String?) {
        if (value == null) {
            throw NullPointerException()
        }
    }
}
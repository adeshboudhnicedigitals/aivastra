package aivastra.nice.interactive.utils

import com.google.gson.Gson
import aivastra.nice.interactive.data.models.ApiErrorWrapper
import retrofit2.Response

object ErrorParser {
    fun <T> parseErrorMessage(response: Response<T>, defaultMsg: String = "Something went wrong"): String {
        return try {
            val errorJson = response.errorBody()?.string()
            if (!errorJson.isNullOrBlank()) {
                val parsed = Gson().fromJson(errorJson, ApiErrorWrapper::class.java)
                parsed.error?.message ?: parsed.error?.code ?: defaultMsg
            } else {
                defaultMsg
            }
        } catch (e: Exception) {
            defaultMsg
        }
    }
}

package aivastra.nice.interactive.data.repository

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.api.ApiService
import aivastra.nice.interactive.data.models.TryOnJobRequest
import aivastra.nice.interactive.data.models.TryOnStatusResponse
import aivastra.nice.interactive.utils.ErrorParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed interface TryOnResult<out T> {
    data class Success<T>(val data: T) : TryOnResult<T>
    data class Failure(val message: String) : TryOnResult<Nothing>
}

class TryOnRepository(
    private val apiService: ApiService = ApiClient.apiService
) {
    suspend fun createTryOnJob(
        garmentId: String,
        customerPhotoKey: String
    ): TryOnResult<String> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.createTryOnJob(
                TryOnJobRequest(
                    merchantCatalogItemId = garmentId,
                    customerPhotoKey = customerPhotoKey
                )
            )
            val body = response.body()
            if (response.isSuccessful && body != null) {
                TryOnResult.Success(body.jobId)
            } else {
                TryOnResult.Failure(ErrorParser.parseErrorMessage(response, "Failed to create try-on job"))
            }
        } catch (e: Exception) {
            TryOnResult.Failure(e.message ?: "Network error creating try-on job")
        }
    }

    suspend fun checkJobStatus(jobId: String): TryOnResult<TryOnStatusResponse> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getTryOnJobStatus(jobId)
            val body = response.body()
            if (response.isSuccessful && body != null) {
                TryOnResult.Success(body)
            } else {
                TryOnResult.Failure(ErrorParser.parseErrorMessage(response, "Failed to check status"))
            }
        } catch (e: Exception) {
            TryOnResult.Failure(e.message ?: "Network error checking job status")
        }
    }

    suspend fun deleteJob(jobId: String): TryOnResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.deleteTryOnJob(jobId)
            if (response.isSuccessful) {
                TryOnResult.Success(Unit)
            } else {
                TryOnResult.Failure(ErrorParser.parseErrorMessage(response, "Failed to delete job"))
            }
        } catch (e: Exception) {
            TryOnResult.Failure(e.message ?: "Network error deleting job")
        }
    }
}

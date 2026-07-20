package com.example.facewixlatest.ApiUtils

/** Every network call exposes whether failure came from the server, network, or client. */
sealed class ApiException(message: String) : Exception(message) {
    class BackendError(val code: String, val backendMessage: String, val httpStatus: Int, val rawBody: String = "") :
        ApiException(backendMessage)

    class NetworkError(cause: Throwable) : ApiException(cause.message ?: "Network error")

    class ClientError(message: String) : ApiException(message)
}
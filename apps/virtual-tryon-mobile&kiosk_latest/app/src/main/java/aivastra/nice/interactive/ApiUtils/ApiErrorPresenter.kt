package com.example.facewixlatest.ApiUtils

object ApiErrorPresenter {
    /** First value is the dialog title; second value is the source-specific message. */
    fun present(error: Throwable): Pair<String, String> {
        return when (error) {
            is ApiException.BackendError ->
                "Server error (${error.code})" to error.backendMessage
            is ApiException.NetworkError ->
                "Connection error" to "Couldn't reach the server - check your network and try again."
            is ApiException.ClientError ->
                "App error" to error.message.orEmpty().ifBlank { "Something went wrong on this device." }
            else ->
                "Unexpected error" to (error.message ?: APIConstant.errorSomethingWrong)
        }
    }
}
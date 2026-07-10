package com.example.facewixlatest.ApiUtils

import aivastra.nice.interactive.BuildConfig

object APIConstant {
    const val errorSomethingWrong = "Oops! Something went wrong. Please try again."
    const val fileNotSupported = "Selected file not supported. Please try another image."
    const val serverTimeOut = "Server time out"
    const val tryOnResultNotReady = "Try-on result image is not ready yet. Please try again in a few moments."

    const val BASE_URL = BuildConfig.API_BASE_URL
    const val BASE_IMAGE_URL = ""
    const val BASE_IMAGE_URL_TRYON = ""
    const val BASE_IMAGE_URL_GARMENTS = ""

    object API_ENDPOINTS {
        const val DEVICE_LOGIN = "v1/auth/device-login"
        const val DEVICE_LOGIN_FORCE = "v1/auth/device-login/force"
        const val DEVICE_REFRESH = "v1/auth/device-refresh"
        const val DEVICE_LOGOUT = "v1/auth/device-logout"
    }

    object Parameter {
        const val AUTHORIZATION = "Authorization"
        const val CONTENT_TYPE = "Content-Type"
    }
}
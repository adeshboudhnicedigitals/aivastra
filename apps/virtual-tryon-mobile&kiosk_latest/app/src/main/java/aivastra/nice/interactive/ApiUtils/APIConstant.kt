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

        const val MERCHANT_CATALOG_SUBCATEGORIES = "v1/merchant/catalog/subcategories"
        const val MERCHANT_CATALOG_ITEMS = "v1/merchant/catalog"

        const val MERCHANT_TRYON_PRESIGN = "v1/merchant/tryon/presign"
        const val MERCHANT_TRYON_JOBS = "v1/merchant/tryon/jobs"
        fun merchantTryonJob(jobId: String) = "v1/merchant/tryon/jobs/$jobId"
        fun merchantTryonJobLike(jobId: String) = "v1/merchant/tryon/jobs/$jobId/like"
        fun merchantTryonJobCart(jobId: String) = "v1/merchant/tryon/jobs/$jobId/cart"

        const val MERCHANT_UPLOAD_SESSIONS = "v1/merchant/tryon/upload-sessions"
        fun merchantUploadSessionStatus(token: String) = "v1/merchant/tryon/upload-sessions/$token"
    }

    object Parameter {
        const val AUTHORIZATION = "Authorization"
        const val CONTENT_TYPE = "Content-Type"
    }
}
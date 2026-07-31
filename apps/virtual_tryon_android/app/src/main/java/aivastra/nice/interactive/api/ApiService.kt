package aivastra.nice.interactive.api

import aivastra.nice.interactive.data.models.DeviceLoginRequest
import aivastra.nice.interactive.data.models.DeviceLoginResponse
import aivastra.nice.interactive.data.models.ForceLoginRequest
import aivastra.nice.interactive.data.models.GoogleLoginRequest
import aivastra.nice.interactive.data.models.MerchantOnboardingRequest
import aivastra.nice.interactive.data.models.MerchantOnboardingResponse
import aivastra.nice.interactive.data.models.OnboardingStatusResponse
import aivastra.nice.interactive.data.models.LogoutRequest
import aivastra.nice.interactive.data.models.LogoutResponse
import aivastra.nice.interactive.data.models.RefreshTokenRequest
import aivastra.nice.interactive.data.models.RefreshTokenResponse
import aivastra.nice.interactive.data.models.CatalogResponse
import aivastra.nice.interactive.data.models.SubcategoryResponse
import aivastra.nice.interactive.data.models.CreateUploadSessionResponse
import aivastra.nice.interactive.data.models.PresignRequest
import aivastra.nice.interactive.data.models.PresignResponse
import aivastra.nice.interactive.data.models.UploadSessionStatusResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.GET
import retrofit2.http.Query
import retrofit2.http.Path

/**
 * Retrofit interface defining all authentication network endpoints.
 */
interface ApiService {

    @POST("v1/merchant/tryon/upload-sessions")
    suspend fun createUploadSession(): Response<CreateUploadSessionResponse>

    @GET("v1/merchant/tryon/upload-sessions/{token}")
    suspend fun getUploadSessionStatus(
        @Path("token") token: String
    ): Response<UploadSessionStatusResponse>

    @POST("v1/merchant/tryon/presign")
    suspend fun presignCustomerPhoto(
        @Body request: PresignRequest
    ): Response<PresignResponse>

    @GET("v1/merchant/tryon/photo-url")
    suspend fun getPhotoUrl(
        @Query("r2Key") r2Key: String
    ): Response<aivastra.nice.interactive.data.models.PhotoUrlResponse>

    @POST("v1/merchant/tryon/jobs")
    suspend fun createTryOnJob(
        @Body request: aivastra.nice.interactive.data.models.TryOnJobRequest
    ): Response<aivastra.nice.interactive.data.models.TryOnJobResponse>

    @GET("v1/merchant/tryon/jobs/{jobId}")
    suspend fun getTryOnJobStatus(
        @Path("jobId") jobId: String
    ): Response<aivastra.nice.interactive.data.models.TryOnStatusResponse>

    @retrofit2.http.DELETE("v1/merchant/tryon/jobs/{jobId}")
    suspend fun deleteTryOnJob(
        @Path("jobId") jobId: String
    ): Response<Unit>

    /**
     * includeDemo defaults true server-side when omitted, but it is passed explicitly
     * here so the admin-curated demo store items (gated by merchants.demoData) are
     * deliberately requested rather than relying on that implicit default.
     */
    @GET("v1/merchant/catalog/subcategories")
    suspend fun getSubcategories(
        @Query("category") category: String,
        @Query("includeDemo") includeDemo: Boolean = true
    ): Response<SubcategoryResponse>

    @GET("v1/merchant/catalog")
    suspend fun getCatalog(
        @Query("includeDemo") includeDemo: Boolean = true
    ): Response<CatalogResponse>

    /** Standard device login. Returns 409 DEVICE_LIMIT_REACHED when max devices exceeded. */
    @POST("v1/auth/device-login")
    suspend fun loginDevice(@Body request: DeviceLoginRequest): Response<DeviceLoginResponse>

    /** Force logout other sessions and login on this device. */
    @POST("v1/auth/device-login/force")
    suspend fun forceLogin(@Body request: ForceLoginRequest): Response<DeviceLoginResponse>

    /** Native Google sign-in — idToken comes from Credential Manager's GetGoogleIdOption. */
    @POST("v1/auth/device-login/google")
    suspend fun loginGoogle(@Body request: GoogleLoginRequest): Response<DeviceLoginResponse>

    /** Refresh access token using a valid refresh token. */
    @POST("v1/auth/device-refresh")
    suspend fun refreshToken(@Body request: RefreshTokenRequest): Response<RefreshTokenResponse>

    /** Logout the current device session. */
    @POST("v1/auth/device-logout")
    suspend fun logoutDevice(@Body request: LogoutRequest): Response<LogoutResponse>

    /** Current merchantStatus + prefill data. Guarded by requireDeviceUser (device-login session, not requireMerchant). */
    @GET("v1/merchant/onboarding")
    suspend fun getOnboardingStatus(): Response<OnboardingStatusResponse>

    /** Creates the merchants row for this user. Returns 409 if one already exists. */
    @POST("v1/merchant/onboarding")
    suspend fun submitOnboarding(@Body request: MerchantOnboardingRequest): Response<MerchantOnboardingResponse>
}

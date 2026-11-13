package aivastra.nice.interactive.navigation

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.graphics.Color
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import aivastra.nice.interactive.ui.components.AppToast
import aivastra.nice.interactive.ui.components.ToastType
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import coil.imageLoader
import coil.request.ImageRequest
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.components.AppLoadingIndicator
import aivastra.nice.interactive.ui.components.ExitSessionDialog
import aivastra.nice.interactive.utils.sdp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import aivastra.nice.interactive.ui.components.SessionInterruptedDialog
import aivastra.nice.interactive.ui.components.RenewalPromptDialog
import aivastra.nice.interactive.data.models.RenewalPromptResponse
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.navigation.compose.composable
import androidx.navigation.NavType
import androidx.navigation.navArgument
import aivastra.nice.interactive.ui.screens.ProfilePage
import aivastra.nice.interactive.ui.screens.ReportsPage
import aivastra.nice.interactive.ui.screens.WebViewPage
import aivastra.nice.interactive.ui.screens.CategorySelectionPage
import aivastra.nice.interactive.utils.CrashReporter
import aivastra.nice.interactive.ui.screens.OnboardingPage
import aivastra.nice.interactive.ui.screens.OutfitSelectionPage
import aivastra.nice.interactive.ui.screens.PendingActivationPage
import aivastra.nice.interactive.ui.screens.PairingPage
import aivastra.nice.interactive.ui.components.StaffSignInDialog
import aivastra.nice.interactive.ui.components.SessionItemBar
import aivastra.nice.interactive.ui.components.WhatsappLooksButton
import aivastra.nice.interactive.ui.components.CartPill
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import aivastra.nice.interactive.device.DeviceStore
import aivastra.nice.interactive.device.EventReporter
import aivastra.nice.interactive.device.InstoreSession
import aivastra.nice.interactive.device.StaffSession
import aivastra.nice.interactive.ui.screens.SplashPage
import aivastra.nice.interactive.ui.screens.OutfitDetailPage
import aivastra.nice.interactive.ui.screens.PoseGuidePage
import aivastra.nice.interactive.ui.screens.PhotoUploadPage
import aivastra.nice.interactive.ui.screens.PhotoReviewPage
import aivastra.nice.interactive.ui.screens.TryOnProcessingPage
import aivastra.nice.interactive.ui.screens.TryOnResultPage
import aivastra.nice.interactive.ui.screens.TryMoreOutfitsPage
import aivastra.nice.interactive.ui.screens.MultiTryOnResultsPage
import aivastra.nice.interactive.ui.screens.DownloadPage
import aivastra.nice.interactive.data.models.CatalogProduct
import aivastra.nice.interactive.data.models.MerchantStatus
import aivastra.nice.interactive.data.repository.AuthResult
import aivastra.nice.interactive.data.repository.CatalogRepository
import aivastra.nice.interactive.data.repository.CatalogResult
import aivastra.nice.interactive.data.repository.OnboardingRepository
import aivastra.nice.interactive.data.repository.OnboardingResult
import aivastra.nice.interactive.data.repository.UserRepository
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.viewmodels.AppVideoViewModel
import aivastra.nice.interactive.viewmodels.MultiTryOnItemStatus
import aivastra.nice.interactive.viewmodels.MultiTryOnViewModel
import aivastra.nice.interactive.viewmodels.TryOnState
import aivastra.nice.interactive.viewmodels.TryOnViewModel

/**
 * Navigation routes definitions.
 */
sealed class Screen(val route: String) {
    object Splash             : Screen("splash")
    /** Device mode: the pairing screen. Kept under the old route so every inherited "sign in
     *  again" path lands on pairing. */
    object SignIn             : Screen("signin")
    object Onboarding         : Screen("onboarding")
    object PendingActivation  : Screen("pending_activation")
    object CategorySelection  : Screen("category_selection")
    object Profile            : Screen("profile")
    object Reports            : Screen("reports")
    object TryOnLibrary       : Screen("tryon_library")
    object ManageCredits      : Screen("manage_credits")
    object OutfitSelection    : Screen("outfit_selection/{category}") {
        fun createRoute(category: String) = "outfit_selection/$category"
    }
    object OutfitDetail       : Screen("outfit_detail")
    object PoseGuide          : Screen("pose_guide/{category}") {
        fun createRoute(category: String) = "pose_guide/$category"
    }
    object PhotoUpload        : Screen("photo_upload")
    object PhotoReview        : Screen("photo_review")
    object TryOnProcessing    : Screen("tryon_processing")
    object TryOnResult        : Screen("tryon_result")
    object MultiTryOnResults  : Screen("multi_tryon_results")
    object TryMoreOutfits     : Screen("try_more_outfits")
    object Download           : Screen("download")
}

/**
 * AppNavGraph configures the standard Jetpack Compose NavHost with
 * instantaneous (zero-lag) transition configurations.
 */
@Composable
fun AppNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier,
    tryOnViewModel: TryOnViewModel = viewModel(),
    multiTryOnViewModel: MultiTryOnViewModel = viewModel(),
    appVideoViewModel: AppVideoViewModel = viewModel()
) {
    val appVideoUri by appVideoViewModel.videoUri.collectAsState()

    var showSessionLimit by remember { mutableStateOf(false) }

    var selectedProduct by remember { mutableStateOf<CatalogProduct?>(null) }
    var activeSubcategoryProductList by remember { mutableStateOf<List<CatalogProduct>>(emptyList()) }
    var fromTryMoreOutfits by rememberSaveable { mutableStateOf(false) }
    // Quick try-on: one camera photo, no outfit. Set by the home menu entry and cleared as
    // soon as an outfit is chosen or a category flow starts, so the shared photo/processing/
    // result screens know which job to start and where "Try More" leads.
    var quickTryOn by rememberSaveable { mutableStateOf(false) }

    var selectedCategory by rememberSaveable { mutableStateOf("women") }
    var capturedPhotoUri by rememberSaveable { mutableStateOf<String?>(null) }
    var customerPhotoR2Key by rememberSaveable { mutableStateOf<String?>(null) }

    // Google login includes a suggested name pair for the onboarding form; password
    // login and the splash session-restore path never do, and OnboardingViewModel
    // falls back to fetching prefill from the server when both are null/blank.
    var onboardingSuggestedContactName by remember { mutableStateOf<String?>(null) }
    var onboardingSuggestedCompanyName by remember { mutableStateOf<String?>(null) }
    var hasEnteredTryMoreFlow by rememberSaveable { mutableStateOf(false) }

    // Saveable so finished looks survive Android reclaiming the idle app (the view models don't).
    val stringListSaver = listSaver<SnapshotStateList<String>, String>(
        save = { it.toList() },
        restore = { it.toMutableStateList() }
    )
    val sessionTryOnResults = rememberSaveable(saver = stringListSaver) { mutableStateListOf<String>() }
    // Parallel to sessionTryOnResults (same index = same result) — job IDs are short
    // enough to fit in the "download all" QR, unlike the presigned result URLs.
    val sessionTryOnJobIds = rememberSaveable(saver = stringListSaver) { mutableStateListOf<String>() }

    val tryOnUiState by tryOnViewModel.uiState.collectAsState()
    val multiTryOnUiState by multiTryOnViewModel.uiState.collectAsState()

    // True only on the first composition of a launch that was restored from saved state, i.e.
    // the app came back after being idle/reclaimed. The view models are then brand new, so any
    // try-on page restored on top would be empty — ask the customer where to go instead.
    var launchedBefore by rememberSaveable { mutableStateOf(false) }
    var sessionInterrupted by remember {
        mutableStateOf(
            launchedBefore &&
                multiTryOnViewModel.uiState.value.items.isEmpty() &&
                tryOnViewModel.uiState.value.state == TryOnState.IDLE
        )
    }
    LaunchedEffect(Unit) { launchedBefore = true }
    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route

    // The server stopped recognising this tablet (deactivated, or unpaired here): back to pairing
    // from wherever the app is. ApiClient clears the token on a DEVICE_INACTIVE 401.
    val paired by DeviceStore.paired.collectAsState()
    LaunchedEffect(paired, currentRoute) {
        if (!paired && currentRoute != null && currentRoute != Screen.Splash.route &&
            currentRoute != Screen.SignIn.route
        ) {
            navController.navigate(Screen.SignIn.route) { popUpTo(0) { inclusive = true } }
        }
    }

    // ── Subscription-expired popup (server-driven) ─────────────────────────
    // Checked on launch and every return to the foreground, but never on the screens a
    // not-yet-active or mid-purchase user is on. Any failure leaves it hidden: an outage
    // must never lock users out.
    var renewalPrompt by remember { mutableStateOf<RenewalPromptResponse?>(null) }
    var renewalUrl by remember { mutableStateOf<String?>(null) }
    var renewalLoading by remember { mutableStateOf(false) }
    // The popup is shown only when the customer taps a category (or Quick Try-On) while the
    // server says the plan is expired — Profile, Reports, logout etc. stay reachable.
    var renewalGateOpen by remember { mutableStateOf(false) }
    var renewalCheckTick by remember { mutableStateOf(0) }
    val renewalEligible = when (currentRoute) {
        null, Screen.Splash.route, Screen.SignIn.route, Screen.Onboarding.route,
        Screen.PendingActivation.route, Screen.ManageCredits.route -> false
        else -> true
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) renewalCheckTick++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(renewalCheckTick, renewalEligible) {
        if (!renewalEligible || !SessionManager.hasValidSession()) {
            renewalPrompt = null
            renewalGateOpen = false
            return@LaunchedEffect
        }
        renewalPrompt = try {
            val response = ApiClient.apiService.getRenewalPrompt()
            response.body()?.takeIf { response.isSuccessful && it.show }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        // Paid (or the popup was switched off): drop the gate along with the prompt.
        if (renewalPrompt == null) renewalGateOpen = false
    }
    val renewalScope = rememberCoroutineScope()

    // Hoisted to the graph root (not inside the MultiTryOnResults composable) so it keeps
    // streaming each item into the shared session history for as long as the batch runs,
    // even after the customer navigates away from that screen — the jobs keep generating
    // in the background regardless of which route is currently on screen.
    LaunchedEffect(multiTryOnUiState.items) {
        multiTryOnUiState.items.forEach { item ->
            val url = item.resultUrl
            if (item.status == MultiTryOnItemStatus.COMPLETED && url != null && !sessionTryOnResults.contains(url)) {
                sessionTryOnResults.add(url)
                val jobId = item.jobId
                if (jobId != null && !sessionTryOnJobIds.contains(jobId)) {
                    sessionTryOnJobIds.add(jobId)
                }
            }
        }
    }

    var lastNavTime by remember { mutableLongStateOf(0L) }

    val safePopBackStack: () -> Unit = {
        val now = android.os.SystemClock.uptimeMillis()
        if (now - lastNavTime >= 350L) {
            lastNavTime = now
            val currentRoute = navController.currentDestination?.route
            if (currentRoute != Screen.CategorySelection.route && navController.previousBackStackEntry != null) {
                navController.popBackStack()
            }
        }
    }

    // While one page is still animating out, the old page is composed (and touchable) next to
    // the new one. Swallow touches for those ~250 ms so a double-tap can't navigate twice.
    val visibleEntries by navController.visibleEntries.collectAsState()
    val isTransitioning = visibleEntries.size > 1

    Box(modifier = Modifier.fillMaxSize()) {
    NavHost(
        navController = navController,
        startDestination = Screen.Splash.route,
        modifier = modifier,
        // Forward: new page slides in from the right and fades in; old page just fades.
        // Back: mirrored. Short and GPU-only (offset + alpha) so it stays smooth on kiosk boxes.
        enterTransition = {
            slideInHorizontally(tween(250)) { it / 6 } + fadeIn(tween(250))
        },
        exitTransition = { fadeOut(tween(150)) },
        popEnterTransition = {
            slideInHorizontally(tween(250)) { -it / 6 } + fadeIn(tween(250))
        },
        popExitTransition = {
            slideOutHorizontally(tween(250)) { it / 6 } + fadeOut(tween(200))
        }
    ) {
        // ── Splash ───────────────────────────────────────────────────────
        composable(
            route = Screen.Splash.route,
        ) { entry ->
            val scope = rememberCoroutineScope()
            var isCheckingSession by remember { mutableStateOf(false) }

            SplashPage(
                isLoading = isCheckingSession,
                onClick = {
                    if (isCheckingSession) return@SplashPage
                    isCheckingSession = true
                    scope.launch {
                        try {
                            // Device mode: a paired tablet goes straight to the shopper home; the
                            // merchant's onboarding/activation belongs to the owner, not the tablet.
                            val destination = if (DeviceStore.paired.value) {
                                Screen.CategorySelection.route
                            } else {
                                Screen.SignIn.route
                            }

                            if (entry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) &&
                                navController.currentDestination?.route == Screen.Splash.route
                            ) {
                                navController.navigate(destination) {
                                    popUpTo(Screen.Splash.route) { inclusive = true }
                                    launchSingleTop = true
                                }
                            }
                        } catch (e: Exception) {
                            CrashReporter.recordException(e, "NavGraph")
                            val fallbackDestination = if (DeviceStore.paired.value) {
                                Screen.CategorySelection.route
                            } else {
                                Screen.SignIn.route
                            }
                            navController.navigate(fallbackDestination) {
                                popUpTo(Screen.Splash.route) { inclusive = true }
                            }
                        } finally {
                            isCheckingSession = false
                        }
                    }
                }
            )
        }

        // ── Sign In ──────────────────────────────────────────────────────
        composable(
            route = Screen.SignIn.route,
        ) {
            PairingPage(
                onPaired = {
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.SignIn.route) { inclusive = true }
                    }
                }
            )
        }

        // ── Onboarding (merchantStatus = ONBOARDING_REQUIRED) ────────────
        composable(
            route = Screen.Onboarding.route,
        ) {
            OnboardingPage(
                suggestedContactName = onboardingSuggestedContactName,
                suggestedCompanyName = onboardingSuggestedCompanyName,
                onOnboardingComplete = {
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.Onboarding.route) { inclusive = true }
                    }
                }
            )
        }

        // ── Pending Activation (merchantStatus = PENDING_ACTIVATION) ─────
        composable(
            route = Screen.PendingActivation.route,
        ) {
            val scope = rememberCoroutineScope()
            PendingActivationPage(
                onLogout = {
                    scope.launch {
                        val refreshToken = SessionManager.refreshToken
                        if (!refreshToken.isNullOrEmpty()) {
                            UserRepository().logoutDevice(refreshToken)
                        }
                        SessionManager.clear()
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }
            )
        }

        // ── Category Selection ───────────────────────────────────────────
        composable(
            route = Screen.CategorySelection.route,
        ) {
            val homeScope = rememberCoroutineScope()
            val staffEmail by StaffSession.email.collectAsState()
            var showStaffSignIn by remember { mutableStateOf(false) }
            // Back on the home screen = the shopper's visit is over (HLD §5.2 step 4).
            LaunchedEffect(Unit) { InstoreSession.end() }
            if (showStaffSignIn) {
                StaffSignInDialog(
                    onDismiss = { showStaffSignIn = false },
                    onSignedIn = { showStaffSignIn = false }
                )
            }
            CategorySelectionPage(
                staffEmail = staffEmail,
                deviceName = DeviceStore.deviceName,
                onStaffSignInClick = { showStaffSignIn = true },
                onStaffSignOutClick = { StaffSession.signOut() },
                onCategorySelected = { categoryId ->
                    if (renewalPrompt != null) {
                        renewalGateOpen = true
                        return@CategorySelectionPage
                    }
                    // A category pick opens the in-store session (kiosk, or assisted while a
                    // staff member is signed in). An expired staff sign-in asks again; any
                    // other failure is retried when the first try-on is created.
                    if (StaffSession.isSignedIn && StaffSession.validToken() == null) {
                        showStaffSignIn = true
                        return@CategorySelectionPage
                    }
                    homeScope.launch { InstoreSession.start() }
                    EventReporter.categoryViewed(categoryId)
                    // Picking a category starts a new customer session, and the photo now comes
                    // before any garment — so nothing from a previous session (photo, held
                    // results, running jobs) may carry over into this one.
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    selectedProduct = null
                    capturedPhotoUri = null
                    customerPhotoR2Key = null
                    hasEnteredTryMoreFlow = false
                    fromTryMoreOutfits = false
                    quickTryOn = false
                    selectedCategory = categoryId
                    navController.navigate(Screen.PoseGuide.createRoute(categoryId))
                },
                onProfileClick = {
                    navController.navigate(Screen.Profile.route)
                },
                onUploadProductsClick = {
                    navController.navigate(Screen.TryOnLibrary.route)
                },
                onQuickTryOnClick = {
                    if (renewalPrompt != null) {
                        renewalGateOpen = true
                        return@CategorySelectionPage
                    }
                    quickTryOn = true
                    // A new quick session: results accumulate across photos from here until Home.
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    navController.navigate(Screen.PhotoUpload.route)
                },
                onReportsClick = {
                    navController.navigate(Screen.Reports.route)
                },
                onManageCreditsClick = {
                    navController.navigate(Screen.ManageCredits.route)
                },
                onLogoutSuccess = {
                    // Unpair: the paired-state observer below routes to the pairing screen.
                    homeScope.launch {
                        InstoreSession.end()
                        DeviceStore.clear()
                    }
                }
            )
        }

        // ── Reports (try-on history) ─────────────────────────────────────
        composable(
            route = Screen.Reports.route,
        ) {
            ReportsPage(onBack = { safePopBackStack() })
        }

        // ── Dedicated Profile Page ───────────────────────────────────────
        composable(
            route = Screen.Profile.route,
        ) {
            ProfilePage(
                onBack = { safePopBackStack() },
                onLogoutSuccess = {
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        // ── Try-On Library (in-app webview) ───────────────────────────────
        composable(
            route = Screen.TryOnLibrary.route,
        ) {
            val tryOnLibraryBaseUrl = "https://app.aivastra.com/tryon-library-app"
            var libraryUrl by remember { mutableStateOf<String?>(null) }

            // Exchanges the device session for a short-lived SSO code so the WebView
            // logs in as the same user instead of showing its own sign-in page. On
            // any failure, falls back to the plain URL so the user can still log in
            // manually rather than being stuck on a blank screen.
            LaunchedEffect(Unit) {
                libraryUrl = try {
                    val response = ApiClient.apiService.getCatalogAppDeviceCode()
                    val code = response.body()?.code
                    if (response.isSuccessful && !code.isNullOrBlank()) {
                        "$tryOnLibraryBaseUrl?code=$code"
                    } else {
                        tryOnLibraryBaseUrl
                    }
                } catch (e: Exception) {
                    CrashReporter.recordException(e, "NavGraph")
                    tryOnLibraryBaseUrl
                }
            }

            val currentLibraryUrl = libraryUrl
            if (currentLibraryUrl == null) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black),
                    contentAlignment = Alignment.Center
                ) {
                    AppLoadingIndicator(size = sdp(R.dimen._32sdp), color = Color(0xFFE7A52C))
                }
            } else {
                WebViewPage(
                    url = currentLibraryUrl,
                    onExit = {
                        navController.navigate(Screen.CategorySelection.route) {
                            popUpTo(Screen.CategorySelection.route) { inclusive = false }
                            launchSingleTop = true
                        }
                    }
                )
            }
        }

        // ── Manage Credits (in-app webview) ────────────────────────────────
        composable(
            route = Screen.ManageCredits.route,
        ) {
            val manageCreditsBaseUrl = "https://app.aivastra.com/pricing"
            var manageCreditsUrl by remember { mutableStateOf<String?>(null) }

            // Exchanges the device session for a short-lived SSO code so the WebView
            // logs in as the same user instead of showing its own sign-in page. On
            // any failure, falls back to the plain URL so the user can still log in
            // manually rather than being stuck on a blank screen.
            LaunchedEffect(Unit) {
                manageCreditsUrl = try {
                    val response = ApiClient.apiService.getCatalogAppDeviceCode()
                    val code = response.body()?.code
                    if (response.isSuccessful && !code.isNullOrBlank()) {
                        "$manageCreditsBaseUrl?code=$code"
                    } else {
                        manageCreditsBaseUrl
                    }
                } catch (e: Exception) {
                    CrashReporter.recordException(e, "NavGraph")
                    manageCreditsBaseUrl
                }
            }

            val currentManageCreditsUrl = manageCreditsUrl
            if (currentManageCreditsUrl == null) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black),
                    contentAlignment = Alignment.Center
                ) {
                    AppLoadingIndicator(size = sdp(R.dimen._32sdp), color = Color(0xFFE7A52C))
                }
            } else {
                WebViewPage(
                    url = currentManageCreditsUrl,
                    onExit = {
                        navController.navigate(Screen.CategorySelection.route) {
                            popUpTo(Screen.CategorySelection.route) { inclusive = false }
                            launchSingleTop = true
                        }
                    },
                    // The pricing page's post-payment success popup sends the user to
                    // "/tryon" (its own try-on page) via client-side routing when
                    // "Continue" is tapped. Catch that redirect and exit to the native
                    // app instead of letting the site's own page load in the WebView.
                    shouldExitOnUrl = { navigatedUrl ->
                        runCatching { Uri.parse(navigatedUrl).path }.getOrNull() == "/tryon"
                    }
                )
            }
        }

        composable(
            route = Screen.OutfitSelection.route,
            arguments = listOf(
                navArgument("category") { type = NavType.StringType }
            ),
        ) { backStackEntry ->
            if (customerPhotoR2Key.isNullOrBlank()) {
                // The photo is uploaded before this screen is ever reached, so it should always
                // be set — if it somehow isn't (e.g. state lost), generation could never start
                // and the screen would look dead. Send the customer back to upload instead.
                Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
                    LaunchedEffect(Unit) {
                        if (backStackEntry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                            if (!navController.popBackStack(Screen.PhotoUpload.route, inclusive = false)) {
                                navController.navigate(Screen.PhotoUpload.route)
                            }
                        }
                    }
                }
            } else {
                OutfitSelectionPage(
                    category = backStackEntry.arguments?.getString("category").orEmpty(),
                    onBack = { safePopBackStack() },
                    onUnauthorized = {
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    generatedItems = multiTryOnUiState.items,
                    onGenerate = { products ->
                        val photoKey = customerPhotoR2Key
                        if (!photoKey.isNullOrBlank()) {
                            // Read straight from the view model so a garment already generating
                            // (or done) is never fired twice, even if this lambda is a frame stale.
                            val alreadyRequested = multiTryOnViewModel.uiState.value.items
                                .map { it.product.id }
                                .toSet()
                            products
                                .filterNot { it.id in alreadyRequested }
                                .forEach { product -> multiTryOnViewModel.addItem(product, photoKey) }
                        }
                    },
                    onViewResults = {
                        navController.navigate(Screen.MultiTryOnResults.route) {
                            launchSingleTop = true
                        }
                    },
                    onUploadProductsClick = {
                        navController.navigate(Screen.TryOnLibrary.route)
                    }
                )
            }
        }

        composable(
            route = Screen.OutfitDetail.route,
        ) { entry ->
            selectedProduct?.let { product ->
                // One item_viewed per garment opened (swiping to another garment re-keys this).
                LaunchedEffect(product.id) { EventReporter.itemViewed(product.id) }
                OutfitDetailPage(
                    product = product,
                    productList = activeSubcategoryProductList,
                    onBack = { safePopBackStack() },
                    onStartTryOn = { targetProduct ->
                        selectedProduct = targetProduct
                        val photoKey = customerPhotoR2Key
                        if (fromTryMoreOutfits && !photoKey.isNullOrBlank()) {
                            // Generates in the background and drops the customer right back on
                            // the browsing screen instead of a full-screen loading page, so
                            // everything already generated stays visible the whole time.
                            if (!multiTryOnViewModel.addItem(targetProduct, photoKey)) {
                                showSessionLimit = true
                            }
                            safePopBackStack()
                        } else {
                            navController.navigate(Screen.PoseGuide.createRoute(selectedCategory))
                        }
                    }
                )
            } ?: Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
                LaunchedEffect(Unit) {
                    if (entry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                        safePopBackStack()
                    }
                }
            }
        }

        composable(
            route = Screen.PoseGuide.route,
            arguments = listOf(
                navArgument("category") { type = NavType.StringType }
            ),
        ) { backStackEntry ->
            PoseGuidePage(
                category = backStackEntry.arguments?.getString("category").orEmpty(),
                onBack = { safePopBackStack() },
                onReady = { navController.navigate(Screen.PhotoUpload.route) }
            )
        }

        composable(
            route = Screen.PhotoUpload.route,
        ) {
            PhotoUploadPage(
                onBack = {
                    // Exiting PhotoUpload backward always lands on the original OutfitDetail
                    // entry, not the one pushed from TryMoreOutfits — clear the reuse-photo
                    // shortcut flag or a stale true skips PhotoUpload/PhotoReview next time.
                    fromTryMoreOutfits = false
                    safePopBackStack()
                },
                onUploadSuccess = { photoUri, r2Key ->
                    // A freshly captured/uploaded photo starts a new customer's session — any
                    // try-on results still held from a previous photo must not leak into this
                    // person's Download page. (No-op if there's nothing to clear yet, e.g. a
                    // retake before any try-on completed.)
                    // Quick try-on keeps its results so the result page can page through all of them.
                    if (!quickTryOn) {
                        sessionTryOnResults.clear()
                        sessionTryOnJobIds.clear()
                    }
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    capturedPhotoUri = photoUri
                    customerPhotoR2Key = r2Key
                    hasEnteredTryMoreFlow = false
                    navController.navigate(Screen.PhotoReview.route)
                }
            )
        }

        composable(
            route = Screen.PhotoReview.route,
        ) { entry ->
            val context = LocalContext.current

            // The customer is only looking at their photo here, so use the time to fetch the
            // garment catalog and warm the first screenful of thumbnails — the picker then opens
            // with everything already loaded. Failures are ignored on purpose: the picker loads
            // (and offers Retry) on its own, so this can only ever make things faster.
            LaunchedEffect(selectedCategory) {
                if (hasEnteredTryMoreFlow) return@LaunchedEffect
                val result = CatalogRepository().getCatalog(selectedCategory)
                if (result is CatalogResult.Success) {
                    // Same default the picker lands on: the first subcategory that has garments.
                    val firstSubcategoryId = result.data.subcategories
                        .firstOrNull { sub -> result.data.products.any { it.subcategoryId == sub.id } }
                        ?.id
                    result.data.products
                        .filter { it.subcategoryId == firstSubcategoryId }
                        .take(12)
                        .forEach { product ->
                            val url = product.mannequinResultUrl ?: product.imageUrl ?: product.thumbnailUrl
                            if (!url.isNullOrBlank()) {
                                context.imageLoader.enqueue(ImageRequest.Builder(context).data(url).build())
                            }
                        }
                }
            }

            val handleBackToUpload: () -> Unit = {
                val now = android.os.SystemClock.uptimeMillis()
                if (now - lastNavTime >= 350L) {
                    lastNavTime = now
                    if (!navController.popBackStack(Screen.PhotoUpload.route, inclusive = false)) {
                        navController.navigate(Screen.PhotoUpload.route)
                    }
                }
            }

            capturedPhotoUri?.let { uri ->
                PhotoReviewPage(
                    photoUri = uri,
                    onBack = handleBackToUpload,
                    onRetake = handleBackToUpload,
                    onProceed = {
                        val quickPhotoKey = customerPhotoR2Key
                        if (quickTryOn && !quickPhotoKey.isNullOrBlank()) {
                            tryOnViewModel.startTryOn(null, quickPhotoKey)
                            navController.navigate(Screen.TryOnProcessing.route)
                        } else if (hasEnteredTryMoreFlow) {
                            navController.navigate(Screen.TryMoreOutfits.route) {
                                popUpTo(Screen.PhotoReview.route) { inclusive = false }
                            }
                        } else {
                            // Photo first, garments second: with the photo uploaded, the customer
                            // now picks garments and generation starts from that screen.
                            val photoKey = customerPhotoR2Key
                            if (!photoKey.isNullOrBlank()) {
                                navController.navigate(Screen.OutfitSelection.createRoute(selectedCategory)) {
                                    launchSingleTop = true
                                }
                            } else {
                                // Set before PhotoReview is ever shown, so this should never trip —
                                // but a silent no-op here leaves the kiosk screen stuck on a Proceed
                                // button that looks dead with no way to tell why. Log it and
                                // recover by sending the customer back to upload instead of stalling.
                                CrashReporter.recordException(
                                    IllegalStateException("Proceed tapped on PhotoReview with photoKeyMissing=true"),
                                    "PhotoReviewProceed"
                                )
                                navController.navigate(Screen.PhotoUpload.route) {
                                    popUpTo(Screen.PhotoReview.route) { inclusive = true }
                                }
                            }
                        }
                    },
                    // Reached here from TryMoreOutfits (reusing an existing photo) rather than
                    // a fresh PhotoUpload — there's no upload step to go "back" to, so the top
                    // button is Home instead, guarded by PhotoReviewPage's own confirmation.
                    cameFromTryMoreOutfits = hasEnteredTryMoreFlow,
                    onGoHome = {
                        hasEnteredTryMoreFlow = false
                        sessionTryOnResults.clear()
                        sessionTryOnJobIds.clear()
                        tryOnViewModel.resetState()
                        multiTryOnViewModel.resetState()
                        navController.navigate(Screen.CategorySelection.route) {
                            popUpTo(Screen.CategorySelection.route) { inclusive = true }
                        }
                    }
                )
            } ?: Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
                LaunchedEffect(Unit) {
                    if (entry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                        handleBackToUpload()
                    }
                }
            }
        }

        composable(
            route = Screen.TryOnProcessing.route,
        ) { entry ->
            LaunchedEffect(tryOnUiState.state, tryOnUiState.shareUrl) {
                val url = tryOnUiState.shareUrl
                val jobId = tryOnUiState.jobId
                if (tryOnUiState.state == TryOnState.COMPLETED && url != null) {
                    if (!sessionTryOnResults.contains(url)) {
                        sessionTryOnResults.add(url)
                        if (jobId != null) sessionTryOnJobIds.add(jobId)
                    }
                    if (entry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                        // Collapse everything back to PhotoReview so TryOnResult always sits
                        // directly on top of it — otherwise repeated "Try Another" loops pile
                        // up TryMoreOutfits/OutfitDetail entries and back navigation has to
                        // walk back through all of them instead of returning to PhotoReview.
                        navController.navigate(Screen.TryOnResult.route) {
                            popUpTo(Screen.PhotoReview.route) { inclusive = false }
                        }
                    }
                }
            }

            val handleCancel: () -> Unit = {
                tryOnViewModel.cancelCurrentTryOnJob()
                safePopBackStack()
            }

            TryOnProcessingPage(
                videoUri = appVideoUri,
                elapsedSeconds = tryOnUiState.elapsedTimeSeconds,
                errorMessage = tryOnUiState.errorMessage,
                onBack = handleCancel,
                onCancel = handleCancel,
                onRetry = {
                    val msg = tryOnUiState.errorMessage.orEmpty().lowercase()
                    val isSessionExpired = msg.contains("expired") || msg.contains("not owned")
                    if (isSessionExpired) {
                        navController.navigate(Screen.PhotoUpload.route) {
                            popUpTo(Screen.PhotoUpload.route) { inclusive = true }
                        }
                    } else {
                        val garmentId = selectedProduct?.id
                        val photoKey = customerPhotoR2Key
                        if (quickTryOn && !photoKey.isNullOrBlank()) {
                            tryOnViewModel.startTryOn(null, photoKey)
                        } else if (!garmentId.isNullOrBlank() && !photoKey.isNullOrBlank()) {
                            tryOnViewModel.startTryOn(garmentId, photoKey)
                        } else {
                            CrashReporter.recordException(
                                IllegalStateException(
                                    "Retry tapped on TryOnProcessing with garmentIdMissing=" +
                                        "${garmentId.isNullOrBlank()}, photoKeyMissing=" +
                                        "${photoKey.isNullOrBlank()}"
                                ),
                                "TryOnProcessingRetry"
                            )
                            navController.navigate(Screen.PhotoUpload.route) {
                                popUpTo(Screen.PhotoReview.route) { inclusive = true }
                            }
                        }
                    }
                }
            )
        }

        composable(
            route = Screen.TryOnResult.route,
        ) { entry ->
            // Quick try-on: back (gesture or arrow) asks what to do with the session instead of
            // silently leaving it, like the regular flow's session exit dialog.
            var showQuickExit by remember { mutableStateOf(false) }
            tryOnUiState.shareUrl?.let { url ->
                // Quick try-on has no outfit to swap, so leaving the result (back or
                // "Try More") reopens the camera for a fresh photo; PhotoUpload's
                // onUploadSuccess clears this session's results.
                val reopenCamera: () -> Unit = {
                    val now = android.os.SystemClock.uptimeMillis()
                    if (now - lastNavTime >= 350L) {
                        lastNavTime = now
                        navController.navigate(Screen.PhotoUpload.route) {
                            popUpTo(Screen.PhotoUpload.route) { inclusive = true }
                        }
                    }
                }
                val tryMoreOutfits: () -> Unit = {
                    hasEnteredTryMoreFlow = true
                    val now = android.os.SystemClock.uptimeMillis()
                    if (now - lastNavTime >= 350L) {
                        lastNavTime = now
                        navController.navigate(Screen.TryMoreOutfits.route) {
                            popUpTo(Screen.PhotoReview.route) { inclusive = false }
                        }
                    }
                }
                TryOnResultPage(
                    resultImageUrl = url,
                    sessionResults = if (quickTryOn) sessionTryOnResults else emptyList(),
                    tryAnotherLabel = if (quickTryOn) "Try More" else "Try Another",
                    onBack = if (quickTryOn) ({ showQuickExit = true }) else tryMoreOutfits,
                    onTryAnother = if (quickTryOn) reopenCamera else tryMoreOutfits,
                    onDownload = {
                        navController.navigate(Screen.Download.route)
                    }
                )
                // Device mode: Wishlist / Sold for the garment just tried on. An overlay, so the
                // inherited result page itself is unchanged.
                selectedProduct?.id?.let { itemId ->
                    Box(modifier = Modifier.fillMaxSize()) {
                        SessionItemBar(
                            catalogItemId = itemId,
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(top = 96.dp, end = 16.dp)
                        )
                    }
                }
                if (showQuickExit) {
                    ExitSessionDialog(
                        onGoHome = {
                            showQuickExit = false
                            quickTryOn = false
                            hasEnteredTryMoreFlow = false
                            sessionTryOnResults.clear()
                            sessionTryOnJobIds.clear()
                            tryOnViewModel.resetState()
                        multiTryOnViewModel.resetState()
                            navController.navigate(Screen.CategorySelection.route) {
                                popUpTo(Screen.CategorySelection.route) { inclusive = true }
                            }
                        },
                        onGoToDownloads = {
                            showQuickExit = false
                            navController.navigate(Screen.Download.route)
                        },
                        onRetake = null,
                        onDismiss = { showQuickExit = false }
                    )
                }
            } ?: Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
                LaunchedEffect(Unit) {
                    if (entry.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                        safePopBackStack()
                    }
                }
            }
        }

        composable(
            route = Screen.MultiTryOnResults.route,
        ) {
            MultiTryOnResultsPage(
                tileActions = { item ->
                    SessionItemBar(
                        catalogItemId = item.product.id,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)
                    )
                },
                items = multiTryOnUiState.items,
                category = selectedCategory,
                onRetryItem = { productId -> multiTryOnViewModel.retryItem(productId) },
                onDownloadAll = { navController.navigate(Screen.Download.route) },
                onAddGarments = { products ->
                    // Stays on this exact screen — each pick is just added to the same
                    // background batch and shows up as a new tile in the grid already here.
                    val photoKey = customerPhotoR2Key?.takeIf { it.isNotBlank() }
                        ?: multiTryOnViewModel.activePhotoKey
                    if (!photoKey.isNullOrBlank()) {
                        products.forEach { product -> multiTryOnViewModel.addItem(product, photoKey) }
                    } else {
                        CrashReporter.recordException(
                            IllegalStateException("Add more looks tapped with no photo key"),
                            "MultiTryOnAddGarments"
                        )
                    }
                },
                onGoHome = {
                    hasEnteredTryMoreFlow = false
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.CategorySelection.route) { inclusive = true }
                    }
                },
                onGoToDownloads = { navController.navigate(Screen.Download.route) },
                onRetake = {
                    val now = android.os.SystemClock.uptimeMillis()
                    if (now - lastNavTime >= 350L) {
                        lastNavTime = now
                        if (!navController.popBackStack(Screen.PhotoUpload.route, inclusive = false)) {
                            navController.navigate(Screen.PhotoUpload.route)
                        }
                    }
                }
            )
        }

        composable(
            route = Screen.TryMoreOutfits.route,
        ) {
            TryMoreOutfitsPage(
                initialCategory = selectedCategory,
                initialProduct = selectedProduct,
                resultImageUrl = tryOnUiState.shareUrl,
                sessionHistory = sessionTryOnResults,
                sessionJobIds = sessionTryOnJobIds,
                onUnauthorized = {
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onGoHome = {
                    hasEnteredTryMoreFlow = false
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.CategorySelection.route) { inclusive = true }
                    }
                },
                onGoToDownloads = {
                    navController.navigate(Screen.Download.route)
                },
                onRetake = {
                    val now = android.os.SystemClock.uptimeMillis()
                    if (now - lastNavTime >= 350L) {
                        lastNavTime = now
                        if (!navController.popBackStack(Screen.PhotoUpload.route, inclusive = false)) {
                            navController.navigate(Screen.PhotoUpload.route)
                        }
                    }
                },
                onSelectOutfitDetail = { product, subcategoryList ->
                    selectedProduct = product
                    quickTryOn = false
                    activeSubcategoryProductList = subcategoryList
                    fromTryMoreOutfits = true
                    navController.navigate(Screen.OutfitDetail.route)
                },
                onTryLook = { newProduct ->
                    selectedProduct = newProduct
                    val photoKey = customerPhotoR2Key
                    if (!photoKey.isNullOrBlank()) {
                        // Generates in the background without leaving this screen, so already
                        // generated looks stay visible/swipeable the whole time.
                        if (!multiTryOnViewModel.addItem(newProduct, photoKey)) {
                            showSessionLimit = true
                        }
                    }
                },
                isGeneratingNewLook = multiTryOnUiState.isAnyInProgress
            )
        }

        composable(
            route = Screen.Download.route,
        ) {
            // The download QR is mode C (spec §4): looks taken home with no number shared.
            LaunchedEffect(Unit) { EventReporter.qrShown("download") }
            DownloadPage(
                resultsList = sessionTryOnResults,
                jobIds = sessionTryOnJobIds,
                onBack = { safePopBackStack() },
                onDeleteSession = {
                    hasEnteredTryMoreFlow = false
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.CategorySelection.route) { inclusive = true }
                    }
                },
                onCreateNew = {
                    hasEnteredTryMoreFlow = false
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.CategorySelection.route) { inclusive = true }
                    }
                },
                onRetake = {
                    val now = android.os.SystemClock.uptimeMillis()
                    if (now - lastNavTime >= 350L) {
                        lastNavTime = now
                        if (!navController.popBackStack(Screen.PhotoUpload.route, inclusive = false)) {
                            navController.navigate(Screen.PhotoUpload.route)
                        }
                    }
                }
            )
            // Mode A: the brand's own WhatsApp, drawn over the page, beside the download QR (CRM phase 2).
            Box(modifier = Modifier.fillMaxSize()) {
                androidx.compose.foundation.layout.Row(
                    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 96.dp, end = 16.dp)
                ) {
                    CartPill()
                    WhatsappLooksButton()
                }
            }
        }
    }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
        ) {
            AppToast(
                visible = showSessionLimit,
                message = "Session limit of ${MultiTryOnViewModel.MAX_SESSION_GARMENTS} garments reached",
                type = ToastType.WARNING,
                autoDismissMs = 3000L,
                onDismiss = { showSessionLimit = false }
            )
        }
        val needsLiveSession = when (currentRoute) {
            Screen.MultiTryOnResults.route, Screen.TryOnProcessing.route, Screen.TryOnResult.route,
            Screen.TryMoreOutfits.route -> true
            Screen.Download.route -> sessionTryOnResults.isEmpty()
            else -> false
        }
        if (sessionInterrupted && needsLiveSession) {
            SessionInterruptedDialog(
                onGoHome = {
                    sessionInterrupted = false
                    hasEnteredTryMoreFlow = false
                    sessionTryOnResults.clear()
                    sessionTryOnJobIds.clear()
                    tryOnViewModel.resetState()
                    multiTryOnViewModel.resetState()
                    navController.navigate(Screen.CategorySelection.route) {
                        popUpTo(Screen.CategorySelection.route) { inclusive = true }
                    }
                },
                onGoToDownloads = if (sessionTryOnResults.isNotEmpty() && currentRoute != Screen.Download.route) {
                    {
                        sessionInterrupted = false
                        navController.navigate(Screen.Download.route) {
                            popUpTo(Screen.CategorySelection.route)
                        }
                    }
                } else null
            )
        }
        val activeRenewalPrompt = renewalPrompt
        if (activeRenewalPrompt != null && renewalGateOpen && renewalUrl == null) {
            RenewalPromptDialog(
                prompt = activeRenewalPrompt,
                onRenew = {
                    if (!renewalLoading) {
                        renewalLoading = true
                        // A device code works once and for 60s, so mint a fresh one per tap.
                        // On failure fall back to the plain pricing page (manual sign-in).
                        renewalScope.launch {
                            val base = "https://app.aivastra.com/pricing"
                            renewalUrl = try {
                                val response = ApiClient.apiService.getCatalogAppDeviceCode()
                                val code = response.body()?.code
                                if (response.isSuccessful && !code.isNullOrBlank()) "$base?code=$code" else base
                            } catch (e: kotlinx.coroutines.CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                CrashReporter.recordException(e, "NavGraph")
                                base
                            }
                            renewalLoading = false
                        }
                    }
                },
                // Closing only returns to the category screen; the next category tap is
                // gated again, so dismissing never grants access.
                onDismiss = { renewalGateOpen = false }
            )
        }
        val activeRenewalUrl = renewalUrl
        if (activeRenewalUrl != null) {
            // Full-screen pricing page over whatever screen is underneath. When the user
            // comes back, re-check: if they paid the server now answers show=false.
            val closeRenewal: () -> Unit = {
                renewalUrl = null
                renewalCheckTick++
            }
            WebViewPage(
                url = activeRenewalUrl,
                onExit = closeRenewal,
                modifier = Modifier.fillMaxSize(),
                shouldExitOnUrl = { navigatedUrl ->
                    runCatching { Uri.parse(navigatedUrl).path }.getOrNull() == "/tryon"
                }
            )
        }
        if (isTransitioning) {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) awaitPointerEvent().changes.forEach { it.consume() }
                        }
                    }
            )
        }
    }
}

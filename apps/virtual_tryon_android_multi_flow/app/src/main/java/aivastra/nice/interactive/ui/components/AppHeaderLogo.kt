package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.utils.sdp
import coil.compose.AsyncImage
import coil.request.ImageRequest

/**
 * Reusable dynamic header logo. Displays the merchant's custom logoUrl if present,
 * or defaults to ai_vastra_new_logo as placeholder across all screens.
 */
@Composable
fun AppHeaderLogo(
    modifier: Modifier = Modifier,
    logoUrl: String? = SessionManager.logoUrl
) {
    // sdp scales with screen-width bucket but not enough to stay visually proportional from
    // phone up to tablet/kiosk, and this logo is used on nearly every screen — sizing it off
    // the real screen width here fixes it everywhere at once instead of per-screen.
    val isMobile = LocalConfiguration.current.screenWidthDp.dp < 500.dp
    val logoWidth = if (isMobile) sdp(R.dimen._170sdp) else sdp(R.dimen._220sdp)
    val logoHeight = if (isMobile) sdp(R.dimen._80sdp) else sdp(R.dimen._92sdp)

    // A merchant can re-upload a new logo to the same URL. Coil caches by URL alone, so
    // without this the header keeps showing the old cached bytes until the cache entry
    // happens to get evicted (users were seeing this as "need to log out/uninstall to see the
    // new logo"). Folding the login version into the cache key forces a fresh network fetch
    // once per login without losing caching within a session.
    val loginVersion by SessionManager.loadingVideoVersion.collectAsState()
    val targetLogo = logoUrl?.takeIf { it.isNotBlank() } ?: SessionManager.logoUrl?.takeIf { it.isNotBlank() }
    if (targetLogo != null) {
        val context = LocalContext.current
        AsyncImage(
            model = ImageRequest.Builder(context)
                .data(targetLogo)
                .memoryCacheKey("$targetLogo|v$loginVersion")
                .diskCacheKey("$targetLogo|v$loginVersion")
                .build(),
            contentDescription = "Ai Vastra Logo",
            contentScale = ContentScale.Fit,
            error = painterResource(R.drawable.ai_vastra_new_logo),
            placeholder = painterResource(R.drawable.ai_vastra_new_logo),
            modifier = modifier
                .width(logoWidth)
                .height(logoHeight)
        )
    } else {
        Image(
            painter = painterResource(R.drawable.ai_vastra_new_logo),
            contentDescription = "Ai Vastra Logo",
            contentScale = ContentScale.Fit,
            modifier = modifier
                .width(logoWidth)
                .height(logoHeight)
        )
    }
}

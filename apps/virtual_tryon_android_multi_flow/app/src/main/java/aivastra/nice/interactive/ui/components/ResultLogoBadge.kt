package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.session.SessionManager
import coil.compose.AsyncImage
import coil.request.ImageRequest

/**
 * The logged-in client's logo, meant to sit in the top-right corner of a result image
 * (place it inside a Box with `Modifier.align(Alignment.TopEnd)`). Falls back to the
 * default Ai Vastra logo when the client has none.
 */
@Composable
fun ResultLogoBadge(
    width: Dp,
    height: Dp,
    modifier: Modifier = Modifier
) {
    val loginVersion by SessionManager.loadingVideoVersion.collectAsState()
    val logo = SessionManager.logoUrl?.takeIf { it.isNotBlank() }
    AsyncImage(
        model = ImageRequest.Builder(LocalContext.current)
            .data(logo ?: R.drawable.ai_vastra_new_logo)
            .memoryCacheKey("$logo|v$loginVersion")
            .diskCacheKey("$logo|v$loginVersion")
            .build(),
        contentDescription = "Client logo",
        contentScale = ContentScale.Fit,
        error = painterResource(R.drawable.ai_vastra_new_logo),
        modifier = modifier
            .width(width)
            .height(height)
    )
}

package aivastra.nice.interactive.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import aivastra.nice.interactive.ui.components.AppHeaderLogo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import aivastra.nice.interactive.R
import aivastra.nice.interactive.data.repository.UserRepository
import aivastra.nice.interactive.data.session.SessionManager
import aivastra.nice.interactive.ui.components.AppDialog
import aivastra.nice.interactive.ui.components.AppLoadingIndicator
import aivastra.nice.interactive.ui.theme.AiVastraTheme
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp
import kotlinx.coroutines.launch

/**
 * Dedicated Profile Page displaying uneditable User Name, Email Address,
 * and a Log Out action matching the exact luxury Ai Vastra design system.
 */
@Composable
fun ProfilePage(
    onBack: () -> Unit,
    onLogoutSuccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    BackHandler(onBack = onBack)

    val scope = rememberCoroutineScope()
    val userRepository = remember { UserRepository() }

    // Retrieve User Email & User Name from SessionManager or fallbacks
    val savedEmail = remember { SessionManager.userEmail ?: "aivastra@gmail.com" }
    val savedUserName = remember {
        SessionManager.userName
            ?: savedEmail.substringBefore("@").replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
            .ifBlank { "AiVastra" }
    }

    var showLogoutDialog by remember { mutableStateOf(false) }
    var isLoggingOut by remember { mutableStateOf(false) }

    val isPreview = LocalInspectionMode.current
    val statusBarH: Dp = (if (isPreview) sdp(R.dimen._28sdp) else WindowInsets.statusBars.asPaddingValues().calculateTopPadding()) + sdp(R.dimen._10sdp)

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // App Background
        Image(
            painter = painterResource(id = R.drawable.new_app_bg),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )

        // Scrollable Content
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = sdp(R.dimen._20sdp))
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = sdp(R.dimen._screen_container_width))
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(Modifier.height(statusBarH))

                // ── Top Bar (Back Arrow + Logo Header) ──────────────────────
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = sdp(R.dimen._10sdp))
                ) {
                    // Back Button
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterStart)
                            .size(sdp(R.dimen._38sdp))
                            .clip(CircleShape)
                            .background(
                                Brush.linearGradient(
                                    listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                                )
                            )
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onBack
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .size(sdp(R.dimen._38sdp))
                                .clip(CircleShape)
                                .background(Brush.linearGradient(listOf(Color(0xFFE7A52C), Color(0xFF9B5100))))
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onBack
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = Color.White,
                                modifier = Modifier.size(sdp(R.dimen._20sdp))
                            )
                        }
                    }

                    // Logo Center
                    AppHeaderLogo(modifier = Modifier.align(Alignment.Center))
                }

                Spacer(Modifier.height(sdp(R.dimen._28sdp)))

                // ── Large Glowing Circular Profile Avatar ───────────────────
                Box(
                    modifier = Modifier
                        .size(sdp(R.dimen._145sdp))
                        .clip(CircleShape)
                        .background(Color(0xFF231F1C))
                        .border(
                            width = sdp(R.dimen._2sdp),
                            brush = Brush.linearGradient(
                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                            ),
                            shape = CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.profile_icon),
                        contentDescription = "User Avatar",
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop
                    )
                }

                Spacer(Modifier.height(sdp(R.dimen._36sdp)))

                // ── Field 1: USERNAME (Uneditable) ──────────────────────────
                FieldLabel(text = "USERNAME")
                Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                UneditableAuthTextField(
                    value = savedUserName,
                    leadingIcon = Icons.Default.Person
                )

                Spacer(Modifier.height(sdp(R.dimen._20sdp)))

                // ── Field 2: EMAIL ADDRESS (Uneditable) ──────────────────────
                FieldLabel(text = "EMAIL ADDRESS")
                Spacer(Modifier.height(sdp(R.dimen._6sdp)))
                UneditableAuthTextField(
                    value = savedEmail,
                    leadingIcon = Icons.Default.Email
                )

                Spacer(Modifier.height(sdp(R.dimen._36sdp)))

                // ── Action Button: LOG OUT ────────────────────────────────────
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(sdp(R.dimen._50sdp))
                        .clip(RoundedCornerShape(sdp(R.dimen._12sdp)))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFE7A52C), Color(0xFF9B5100))
                            )
                        )
                        .clickable(enabled = !isLoggingOut) {
                            showLogoutDialog = true
                        },
                    contentAlignment = Alignment.Center
                ) {
                    if (isLoggingOut) {
                        AppLoadingIndicator(size = sdp(R.dimen._22sdp), color = Color.White)
                    } else {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                                contentDescription = "Log Out",
                                tint = Color.White,
                                modifier = Modifier.size(sdp(R.dimen._22sdp))
                            )
                            Spacer(Modifier.width(sdp(R.dimen._10sdp)))
                            Text(
                                text = "LOG OUT",
                                color = Color.White,
                                fontFamily = PoppinsFamily,
                                fontWeight = FontWeight.Bold,
                                fontSize = ssp(R.dimen._16ssp)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(sdp(R.dimen._32sdp)))
            }
        }

        // ── Logout Confirmation Dialog ──────────────────────────────────────
        if (showLogoutDialog) {
            AppDialog(
                title = "Logout Confirmation",
                message = "Are you sure you want to log out of your Ai Vastra account?",
                icon = Icons.AutoMirrored.Filled.ExitToApp,
                warningText = "You will need to sign in again to access virtual try-on.",
                confirmText = "Logout",
                cancelText = "Cancel",
                isLoading = isLoggingOut,
                onConfirm = {
                    isLoggingOut = true
                    scope.launch {
                        val token = SessionManager.refreshToken
                        if (!token.isNullOrBlank()) {
                            userRepository.logoutDevice(token)
                        }
                        SessionManager.clear()
                        isLoggingOut = false
                        showLogoutDialog = false
                        onLogoutSuccess()
                    }
                },
                onDismiss = {
                    if (!isLoggingOut) showLogoutDialog = false
                }
            )
        }
    }
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

@Composable
private fun FieldLabel(text: String) {
    Text(
        text = text,
        color = Color(0xFFD99A2D),
        fontSize = ssp(R.dimen._12ssp),
        fontWeight = FontWeight.Bold,
        fontFamily = PoppinsFamily,
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun UneditableAuthTextField(
    value: String,
    leadingIcon: ImageVector
) {
    OutlinedTextField(
        value = value,
        onValueChange = {},
        readOnly = true,
        enabled = false,
        leadingIcon = {
            Icon(
                imageVector = leadingIcon,
                contentDescription = null,
                tint = Color(0xFFD88A18)
            )
        },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            disabledTextColor = Color.White,
            disabledBorderColor = Color(0xFFD88A18).copy(alpha = 0.5f),
            disabledContainerColor = Color(0xFF141210).copy(alpha = 0.8f),
            disabledLeadingIconColor = Color(0xFFD88A18)
        )
    )
}

// ─── Preview ─────────────────────────────────────────────────────────────────

@Preview(
    name = "Profile Page - Phone",
    showBackground = true,
    showSystemUi = true,
    device = "spec:width=411dp,height=891dp,dpi=420"
)
@Composable
private fun ProfilePagePreview() {
    AiVastraTheme {
        ProfilePage(onBack = {}, onLogoutSuccess = {})
    }
}

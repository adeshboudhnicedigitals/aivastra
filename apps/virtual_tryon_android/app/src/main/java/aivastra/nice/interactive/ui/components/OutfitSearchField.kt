package aivastra.nice.interactive.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import aivastra.nice.interactive.R
import aivastra.nice.interactive.ui.theme.PoppinsFamily
import aivastra.nice.interactive.utils.sdp
import aivastra.nice.interactive.utils.ssp

/**
 * Search box for the outfit lists. Purely a text input — callers filter their own
 * in-memory list on each change, so there is no debounce or loading state here.
 * Shape/colors are parameters because the Try More Outfits side panel is far
 * narrower than the Outfit Selection page and styles its controls differently.
 */
@Composable
fun OutfitSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search by name or SKU",
    shape: Shape = RoundedCornerShape(sdp(R.dimen._40sdp)),
    containerColor: Color = Color(0xFF151515),
    idleBorderColor: Color = Color.White.copy(alpha = 0.22f),
    contentPadding: PaddingValues = PaddingValues(
        horizontal = sdp(R.dimen._14sdp),
        vertical = sdp(R.dimen._9sdp)
    )
) {
    val focusManager = LocalFocusManager.current
    val textStyle = TextStyle(
        color = Color.White,
        fontSize = ssp(R.dimen._12ssp),
        fontWeight = FontWeight.Medium,
        fontFamily = PoppinsFamily
    )

    BasicTextField(
        value = query,
        onValueChange = onQueryChange,
        singleLine = true,
        textStyle = textStyle,
        cursorBrush = SolidColor(Color(0xFFE59B17)),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        // Results are already live; the Search key only needs to dismiss the keyboard.
        keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(containerColor)
            .border(
                sdp(R.dimen._1sdp),
                if (query.isNotEmpty()) Color(0xFFE59B17) else idleBorderColor,
                shape
            )
            .padding(contentPadding),
        decorationBox = { innerTextField ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Filled.Search,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.6f),
                    modifier = Modifier.size(sdp(R.dimen._16sdp))
                )
                Spacer(Modifier.width(sdp(R.dimen._6sdp)))
                Box(modifier = Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text(
                            text = placeholder,
                            style = textStyle,
                            color = Color.White.copy(alpha = 0.45f),
                            maxLines = 1
                        )
                    }
                    innerTextField()
                }
                if (query.isNotEmpty()) {
                    Spacer(Modifier.width(sdp(R.dimen._6sdp)))
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Clear search",
                        tint = Color.White.copy(alpha = 0.78f),
                        modifier = Modifier
                            .size(sdp(R.dimen._16sdp))
                            .clip(CircleShape)
                            .clickable { onQueryChange("") }
                    )
                }
            }
        }
    )
}

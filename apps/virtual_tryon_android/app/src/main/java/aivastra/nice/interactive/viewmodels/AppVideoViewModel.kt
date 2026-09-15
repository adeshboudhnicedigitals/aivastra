package aivastra.nice.interactive.viewmodels

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import aivastra.nice.interactive.data.repository.AppVideoRepository
import aivastra.nice.interactive.data.session.SessionManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// Activity-scoped (obtained once at the NavGraph root), which is created at app launch —
// before login is guaranteed to have happened. Fetching only once in init() would freeze the
// video at whatever SessionManager held at that instant and never pick up a merchant's video
// from a login that completes afterward (or a merchant switch within the same app process), so
// this re-fetches on every SessionManager.loadingVideoVersion bump, i.e. every fresh login —
// not just once at cold start.
class AppVideoViewModel @JvmOverloads constructor(
    application: Application = Application(),
    private val repository: AppVideoRepository = AppVideoRepository()
) : AndroidViewModel(application) {

    private val _videoUri = MutableStateFlow<Uri?>(null)
    val videoUri: StateFlow<Uri?> = _videoUri.asStateFlow()

    init {
        viewModelScope.launch {
            SessionManager.loadingVideoVersion.collect {
                try {
                    _videoUri.value = repository.fetchAppVideoUri(getApplication())
                } catch (_: Exception) {
                    _videoUri.value = null
                }
            }
        }
    }
}

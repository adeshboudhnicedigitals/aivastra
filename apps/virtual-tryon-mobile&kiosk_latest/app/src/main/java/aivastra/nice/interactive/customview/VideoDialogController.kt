package aivastra.nice.interactive.customview

import kotlinx.coroutines.flow.MutableSharedFlow

object VideoDialogController {
    val closeFlow = MutableSharedFlow<Unit>(
        replay = 0,
        extraBufferCapacity = 1
    )
}
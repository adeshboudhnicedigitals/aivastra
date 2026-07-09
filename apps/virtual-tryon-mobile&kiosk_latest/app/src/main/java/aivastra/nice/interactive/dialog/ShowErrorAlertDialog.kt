package aivastra.nice.interactive.dialog

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.DialogErrorAlertBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog.ImageSourceType
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.bumptech.glide.Glide
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import java.io.File

class ShowErrorAlertDialog(private val imageSourceType: ImageSourceType,
                           private  val txtErrorTitle:String,
                           private  val txtErrorMsg:String,
                           private var positiveBtnClick: (() -> Unit)? = null) : BottomSheetDialogFragment() {

    private lateinit var errorAlertBinding: DialogErrorAlertBinding

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        errorAlertBinding =
            DialogErrorAlertBinding.inflate(inflater, container, false)
        initView()
        return errorAlertBinding.root
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        return super.onCreateDialog(savedInstanceState).apply {
            setOnShowListener { dialogInterface ->
                val bottomSheet = (dialogInterface as BottomSheetDialog)
                    .findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)

                bottomSheet?.background = ColorDrawable(Color.TRANSPARENT) // Force transparency
                if (bottomSheet != null) {
                    // Set the background to transparent
                    bottomSheet.setBackgroundColor(Color.TRANSPARENT)

                    // Force full height
                    val behavior = BottomSheetBehavior.from(bottomSheet)
                    behavior.state = BottomSheetBehavior.STATE_EXPANDED
                    behavior.isDraggable = false
                    behavior.skipCollapsed = true
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()

        // Make the dialog full-screen immediately
        dialog?.let { dlg ->
            dlg.setCancelable(false)  // Prevents dismiss on back press
            dlg.setCanceledOnTouchOutside(false)  // Prevents dismiss on outside touch

            val bottomSheet =
                dlg.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
            bottomSheet?.layoutParams?.height = ViewGroup.LayoutParams.MATCH_PARENT
        }
    }

    override fun getTheme(): Int = R.style.BottomSheetDialogThemeFullWidth

    private fun initView() {
        errorAlertBinding.txtAlertMsg.text = txtErrorMsg
        errorAlertBinding.txtAlertTitle.text = txtErrorTitle
        val imageUrl = when (imageSourceType) {
            is ImageSourceType.FromFile -> imageSourceType.file.absolutePath
            is ImageSourceType.FromUrl -> imageSourceType.url
            is ImageSourceType.FromPath -> imageSourceType.path
            is ImageSourceType.FromDrawbleRes -> imageSourceType.resId
        }
        Glide.with(requireActivity()).load(imageUrl).into(errorAlertBinding.imgAlertIcon)
        errorAlertBinding.btnPositive.setOnClickListener{
            positiveBtnClick?.invoke()
            dismiss()
        }
    }

    sealed class ImageSourceType {
        data class FromFile(val file: File) : ImageSourceType()
        data class FromUrl(val url: String) : ImageSourceType()
        data class FromPath(val path: String) : ImageSourceType()
        data class FromDrawbleRes(val resId: Int) :ImageSourceType()

    }
}
package aivastra.nice.aivastraadmin.dialog

import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.databinding.DialogUploadPhotoBinding
import aivastra.nice.aivastraadmin.utils.ViewControll
import aivastra.nice.aivastraadmin.viewmodels.ProductUploadViewModel
import aivastra.nice.interactive.Loader.LoaderManager
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.lifecycle.ViewModelProvider
import com.bumptech.glide.Glide
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import java.io.File

class UploadPhotoDialog(private  val selectedPhotoPath:String,
                        private  val subcategoryId:String,
                        private  val sareeStyleId:String?,
                        private val onCompleted:(String)->Unit) : BottomSheetDialogFragment() {

    private lateinit var binding: DialogUploadPhotoBinding
    private lateinit var productUploadViewmodel: ProductUploadViewModel
    private var isGenerateApiRunning = false

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = DialogUploadPhotoBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        return super.onCreateDialog(savedInstanceState).apply {
            setOnShowListener {
                dialogInterface ->
                val bottomSheet = (dialogInterface as BottomSheetDialog)
                    .findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)

                bottomSheet?.background = ColorDrawable(Color.TRANSPARENT) // Force transparency
                if (bottomSheet != null) {
                    // Set the background to transparent
                    bottomSheet.setBackgroundColor(Color.TRANSPARENT)

                    // Force full height
                    val behavior = BottomSheetBehavior.from(bottomSheet)
                    behavior.state = BottomSheetBehavior.STATE_EXPANDED
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

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initView()
    }

    private fun initView() {
        // Scoped to the parent fragment, not this dialog — finalizeProduct() runs later
        // against the parent's own ProductUploadViewModel instance, so pendingItemId set
        // here by generateProduct() must land on the same instance or it's lost when this
        // dialog is dismissed.
        productUploadViewmodel = ViewModelProvider(requireParentFragment()).get(ProductUploadViewModel::class.java)
        Glide.with(requireActivity()).load(File(selectedPhotoPath)).into(binding.imgSelected)
        binding.iconCancle.setOnClickListener{
            dismiss()
        }
        binding.btnUpload.setOnClickListener {
            uploadProductImageAPI()
        }
    }

    private fun uploadProductImageAPI(){
        keepScreenOn()
        LoaderManager.show(requireActivity(),dialog?.window?.decorView as ViewGroup,true)
        LoaderManager.setMessage(getString(R.string.uploading_your_product))
        productUploadViewmodel.generateProduct(File(selectedPhotoPath), subcategoryId, sareeStyleId)
        productUploadViewmodel.generateState.observe(this) { state ->
            when (state) {
                is ProductUploadViewModel.GenerateState.Completed -> {
                    LoaderManager.remove(requireActivity())
                    clearKeepScreenOn()
                    onCompleted(state.resultUrl)
                    dismiss()
                }
                is ProductUploadViewModel.GenerateState.Failed -> {
                    LoaderManager.remove(requireActivity())
                    clearKeepScreenOn()
                    ViewControll.showMessage(requireActivity(), state.message)
                    dismiss()
                }
                else -> { /* Uploading / Generating — loader already shown */ }
            }
        }
    }

    private fun keepScreenOn() {
        isGenerateApiRunning = true
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun clearKeepScreenOn() {
        isGenerateApiRunning = false
        activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onDestroyView() {
        if (isGenerateApiRunning) {
            clearKeepScreenOn()
        }
        super.onDestroyView()
    }

    sealed class ImageSourceType {
        data class FromFile(val file: File) : ImageSourceType()
        data class FromUrl(val url: String) : ImageSourceType()
        data class FromPath(val path: String) : ImageSourceType()
    }
}

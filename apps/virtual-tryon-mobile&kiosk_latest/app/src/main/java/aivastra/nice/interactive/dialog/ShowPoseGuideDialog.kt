package aivastra.nice.interactive.dialog

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.DialogShowPoseGuideBinding
import aivastra.nice.interactive.utils.AppConstant
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class ShowPoseGuideDialog(private val vastraFor:String) : BottomSheetDialogFragment() {

    private lateinit var binding: DialogShowPoseGuideBinding

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = DialogShowPoseGuideBinding.inflate(inflater, container, false)
        return binding.root
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

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initView()
    }


    private fun initView() {
        binding.btnReady.setOnClickListener{
            dismiss()
        }
        if(vastraFor.equals(AppConstant.MEN,true)){
            binding.imgPoseFor.setImageResource(R.drawable.image_pose_guide_men)
        }else if(vastraFor.equals(AppConstant.GIRL,true)){
            binding.imgPoseFor.setImageResource(R.drawable.image_pose_guide_girl)
        }else if(vastraFor.equals(AppConstant.BOY,true)){
            binding.imgPoseFor.setImageResource(R.drawable.image_pose_guide_boy)
        }else{
            binding.imgPoseFor.setImageResource(R.drawable.image_pose_guide_women)
        }
    }

}
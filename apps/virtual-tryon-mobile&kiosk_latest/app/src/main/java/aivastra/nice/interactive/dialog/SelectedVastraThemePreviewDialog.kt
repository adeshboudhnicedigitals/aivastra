package aivastra.nice.interactive.dialog

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.DialogSelectedVastraThemeBinding
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class SelectedVastraThemePreviewDialog(private val selectedVastraSubcat: DressesTypeDataModel.Data.Subcategory,
                                       private val selectedVastraItem:DressesTypeDataModel.Data.Subcategory.Item,
                                       private val dismissCallback:(DressesTypeDataModel.Data.Subcategory.Item)->Unit) : BottomSheetDialogFragment() {

    private lateinit var binding: DialogSelectedVastraThemeBinding
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = DialogSelectedVastraThemeBinding.inflate(inflater, container, false)
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
            dlg.setCancelable(true)  // Prevents dismiss on back press
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

    private val autoScrollRunnable = object : Runnable {
        override fun run() {
            if (!isAdded || selectedVastraSubcat.items.isEmpty()) return

            val next = (binding.viewpagerSlider.currentItem + 1) % selectedVastraSubcat.items.size
            binding.viewpagerSlider.setCurrentItem(next, true)
            handler.postDelayed(this, 60_000)
        }
    }

    private fun initView() {
        ViewControll.setCompanyLogoHorizontal(requireActivity(),binding.llToolbar.appLogo)
        binding.viewpagerSlider.adapter = VastraSliderAdapter(requireActivity(),selectedVastraSubcat.items)
        binding.viewpagerSlider.post {
            selectedVastraSubcat.items.forEachIndexed { index, item ->
                if(item.fullpath.equals(selectedVastraItem.fullpath)){
                    binding.viewpagerSlider.setCurrentItem(index,true)
                }
            }
        }
        binding.viewpagerSlider.registerOnPageChangeCallback(
            object : ViewPager2.OnPageChangeCallback() {
                override fun onPageScrollStateChanged(state: Int) {
                    when (state) {
                        ViewPager2.SCROLL_STATE_DRAGGING -> {
                            pauseAutoScroll()
                        }
                        ViewPager2.SCROLL_STATE_IDLE -> {
                            // User stopped interacting → restart timer
                            startAutoScroll()
                        }
                    }
                }
                override fun onPageSelected(position: Int) {
                    binding.btnPrevious.isEnabled = position != 0
                    binding.btnNext.isEnabled = position != selectedVastraSubcat.items.size - 1
                }
            }
        )
        binding.btnReady.setOnClickListener{
            val currentItemIndex = binding.viewpagerSlider.currentItem
            dismissCallback.invoke(selectedVastraSubcat.items[currentItemIndex])
        }
        binding.llToolbar.imgBack.setOnClickListener{
            dismiss()
        }
        binding.btnPrevious.setOnClickListener {
            val current = binding.viewpagerSlider.currentItem
            if (current > 0) {
                binding.viewpagerSlider.setCurrentItem(current - 1, true)
            }
        }

        binding.btnNext.setOnClickListener {
            val current = binding.viewpagerSlider.currentItem
            if (current < selectedVastraSubcat.items.size - 1) {
                binding.viewpagerSlider.setCurrentItem(current + 1, true)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        startAutoScroll()
    }

    override fun onPause() {
        pauseAutoScroll()
        super.onPause()
    }

    override fun onDestroyView() {
        pauseAutoScroll()
        super.onDestroyView()
    }

    private fun startAutoScroll() {
        handler.removeCallbacks(autoScrollRunnable)
        handler.postDelayed(autoScrollRunnable, 60_000)
    }

    private fun pauseAutoScroll() {
        handler.removeCallbacks(autoScrollRunnable)
    }
}
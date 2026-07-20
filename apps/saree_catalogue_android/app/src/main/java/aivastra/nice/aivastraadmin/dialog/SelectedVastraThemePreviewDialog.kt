package aivastra.nice.aivastraadmin.dialog
import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.databinding.DialogSelectedVastraThemeBinding
import aivastra.nice.aivastraadmin.fragment.adapter.VastraSliderAdapter
import aivastra.nice.aivastraadmin.viewmodels.MerchantCatalogItem
import aivastra.nice.aivastraadmin.viewmodels.MerchantCatalogSubcategory
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
class SelectedVastraThemePreviewDialog(private val selectedVastraSubcat:MerchantCatalogSubcategory,private val items:List<MerchantCatalogItem>,private val selectedVastraItem:MerchantCatalogItem,private val dismissCallback:(MerchantCatalogItem)->Unit):BottomSheetDialogFragment(){private lateinit var binding:DialogSelectedVastraThemeBinding;override fun onCreateView(i:LayoutInflater,c:ViewGroup?,s:Bundle?):View{binding=DialogSelectedVastraThemeBinding.inflate(i,c,false);return binding.root};override fun onViewCreated(v:View,s:Bundle?){binding.txtCatName.text=selectedVastraSubcat.name;binding.viewpagerSlider.adapter=VastraSliderAdapter(requireActivity(),items);binding.viewpagerSlider.post{items.indexOfFirst{it.id==selectedVastraItem.id}.takeIf{it>=0}?.let{binding.viewpagerSlider.setCurrentItem(it,false)}};binding.viewpagerSlider.registerOnPageChangeCallback(object:ViewPager2.OnPageChangeCallback(){override fun onPageSelected(p:Int){binding.btnPrevious.isVisible=p>0;binding.btnNext.isVisible=p<items.lastIndex}});binding.imgBack.setOnClickListener{dismiss()};binding.btnPrevious.setOnClickListener{binding.viewpagerSlider.currentItem.let{if(it>0)binding.viewpagerSlider.setCurrentItem(it-1,true)}};binding.btnNext.setOnClickListener{binding.viewpagerSlider.currentItem.let{if(it<items.lastIndex)binding.viewpagerSlider.setCurrentItem(it+1,true)}}}}
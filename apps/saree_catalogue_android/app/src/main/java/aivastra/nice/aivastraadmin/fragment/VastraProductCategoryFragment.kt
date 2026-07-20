package aivastra.nice.aivastraadmin.fragment
import android.os.Bundle
import android.view.*
import android.view.inputmethod.EditorInfo
import androidx.fragment.app.Fragment
import androidx.core.view.isVisible
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.databinding.FragmentVastraProductCategoryBinding
import aivastra.nice.aivastraadmin.dialog.SelectedVastraThemePreviewDialog
import aivastra.nice.aivastraadmin.fragment.adapter.ProductCategoryItemAdapter
import aivastra.nice.aivastraadmin.utils.ViewControll
import aivastra.nice.aivastraadmin.viewmodels.*
import aivastra.nice.interactive.Loader.LoaderManager
import aivastra.nice.interactive.activity.vastra.ProductSubCategoryAdapter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
class VastraProductCategoryFragment:Fragment(){private lateinit var binding:FragmentVastraProductCategoryBinding;private lateinit var vm:ProductUploadViewModel;private lateinit var itemAdapter:ProductCategoryItemAdapter;private lateinit var selected:MerchantCatalogSubcategory;private var currentItems:List<MerchantCatalogItem> = emptyList();private var searchAdapter:ProductCategoryItemAdapter?=null;private var searchJob:Job?=null
 override fun onCreateView(i:LayoutInflater,c:ViewGroup?,s:Bundle?):View{binding=FragmentVastraProductCategoryBinding.inflate(i,c,false);return binding.root}
 override fun onViewCreated(v:View,s:Bundle?){vm=ViewModelProvider(this)[ProductUploadViewModel::class.java];load();search()}
 private fun load(){LoaderManager.show(requireActivity(),requireActivity().findViewById(android.R.id.content),true);vm.fetchSubcategories("women");vm.error.observe(viewLifecycleOwner){if(it!=null){LoaderManager.remove(requireActivity());binding.txtNoData.isVisible=true}};vm.subcategories.observe(viewLifecycleOwner){list->LoaderManager.remove(requireActivity());if(list.isEmpty())binding.txtNoData.isVisible=true else{selected=list[0];itemAdapter=ProductCategoryItemAdapter{item,_->preview(selected,currentItems,item)};binding.recyclerVastraItem.adapter=itemAdapter;val a=ProductSubCategoryAdapter(list){sub,_->selected=sub;items(sub.id)};binding.recyclerVastraCategory.adapter=a;binding.rlMainCatlist.isVisible=true;a.selectedItemPositionDefault(0)}}}
 private fun items(id:String){vm.fetchItems(id);vm.catalogItems.observe(viewLifecycleOwner){list->currentItems=list;binding.recyclerVastraItem.isVisible=true;binding.recyclerSearchProductItem.isVisible=false;itemAdapter.submitList(list)}}
 private fun search(){searchAdapter=ProductCategoryItemAdapter{i,_->preview(selected,currentItems,i)};binding.recyclerSearchProductItem.adapter=searchAdapter;binding.etProductSearch.addTextChangedListener{searchJob?.cancel();searchJob=lifecycleScope.launch{delay(500)}};binding.etProductSearch.setOnEditorActionListener{_,a,e->if(a==EditorInfo.IME_ACTION_SEARCH||(e?.keyCode==KeyEvent.KEYCODE_ENTER)){val q=binding.etProductSearch.text.toString().trim();vm.searchItems(q);vm.catalogItems.observe(viewLifecycleOwner){list->binding.recyclerVastraItem.isVisible=false;binding.recyclerSearchProductItem.isVisible=true;searchAdapter?.submitList(list)};true}else false}}
 private fun preview(s:MerchantCatalogSubcategory,list:List<MerchantCatalogItem>,item:MerchantCatalogItem){SelectedVastraThemePreviewDialog(s,list,item){}.show(childFragmentManager,"SelectedVastraThemePreviewDialog")}}
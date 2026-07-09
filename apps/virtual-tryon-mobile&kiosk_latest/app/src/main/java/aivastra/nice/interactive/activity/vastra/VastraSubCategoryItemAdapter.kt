package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ItemVastraCategoryBinding
import aivastra.nice.interactive.databinding.ItemVastraProductBinding
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.others.DiffVastraItemCallback
import android.content.res.ColorStateList
import android.graphics.Paint
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.databinding.DataBindingUtil
import androidx.recyclerview.widget.RecyclerView
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlin.collections.ArrayList
import androidx.recyclerview.widget.ListAdapter

class VastraSubCategoryItemAdapter(private val onClickEvent:(DressesTypeDataModel.Data.Subcategory.Item,Int)->Unit)
    :  ListAdapter<DressesTypeDataModel.Data.Subcategory.Item,
        VastraSubCategoryItemAdapter.RecyclerViewViewHolder>(DiffVastraItemCallback())
    {

        private var selectedPosition: Int = -1

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerViewViewHolder {
            val binding: ItemVastraProductBinding = DataBindingUtil.inflate(
                LayoutInflater.from(parent.context),
                R.layout.item_vastra_product, parent, false
            )
            return  RecyclerViewViewHolder(binding)
        }

        override fun onBindViewHolder(holder: RecyclerViewViewHolder, position: Int) {
            val itemData: DressesTypeDataModel.Data.Subcategory.Item = getItem(position)
            val viewHolder: RecyclerViewViewHolder = holder as RecyclerViewViewHolder
            viewHolder.bindItem(itemData)
            // Change border based on selection
            changeSelectedItemViewTint(position,viewHolder)
            // Handle item selection
            viewHolder.itemView.setOnClickListener {
                selectedItemPosition(position)
            }
        }

        fun selectedItemPosition(position: Int){
            val previousPosition = selectedPosition
            selectedPosition = position
            notifyItemChanged(previousPosition) // Reset previous selection
            notifyItemChanged(selectedPosition) // Highlight current selection
            onClickEvent(getItem(position),position) // Trigger click listener
        }

        private fun changeSelectedItemViewTint(position: Int,viewHolder: RecyclerViewViewHolder){
            val context = viewHolder.itemView.context
            if (position == selectedPosition) {
                ViewCompat.setBackgroundTintList(viewHolder.binding.llMainItemview, null)
            } else {
                ViewCompat.setBackgroundTintList(viewHolder.binding.llMainItemview, ColorStateList.valueOf(ContextCompat.getColor(context, R.color.purple)))
            }
        }

        fun selectedItemPositionDefault(position: Int){
            selectedPosition = position
            notifyItemChanged(selectedPosition)
        }

        fun resetSelection() {
            val previousPosition = selectedPosition
            selectedPosition = -1
            if (previousPosition != -1) {
                notifyItemChanged(previousPosition) // Reset previous selection
            }
        }

        class RecyclerViewViewHolder(binding: ItemVastraProductBinding) :
            RecyclerView.ViewHolder(binding.getRoot()) {
            var binding: ItemVastraProductBinding

            init {
                this.binding = binding
            }

            fun bindItem(itemData: DressesTypeDataModel.Data.Subcategory.Item) {
                binding.txtVastraProductid.text = "Sku:${itemData.sku_number}"
                binding.txtProductOfferPrice.text = "\u20B9${itemData.offerprice}"
                binding.txtProductPrice.text = "\u20B9${itemData.price}"
                binding.txtProductPrice.paintFlags =  binding.txtProductPrice.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                try {
                    val imageLoader = binding.imgVastraItem.context.imageLoader
                    val request = ImageRequest.Builder(binding.root.context)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .data(APIConstant.BASE_URL + itemData.fullpath)
                        .target(binding.imgVastraItem)
                        .build()
                    val disposable = imageLoader.enqueue(request)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                binding.executePendingBindings()
            }
        }
    }


package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ItemVastraBinding
import aivastra.nice.interactive.databinding.ItemVastraCategoryBinding
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.databinding.DataBindingUtil
import androidx.recyclerview.widget.RecyclerView
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import java.util.*
import kotlin.collections.ArrayList

class VastraCategoryItemAdapter(private val subcategoryList: ArrayList<DressesTypeDataModel.Data.Subcategory.Item>,
                                private val onClickEvent:(DressesTypeDataModel.Data.Subcategory.Item,Int)->Unit) : RecyclerView.Adapter<RecyclerView.ViewHolder>()
    {

        private var selectedPosition: Int = -1
        var currentSearchBy: String = ""

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val binding: ItemVastraBinding = DataBindingUtil.inflate(
                LayoutInflater.from(parent.context),
                R.layout.item_vastra, parent, false
            )
            return  RecyclerViewViewHolder(binding)
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            val itemData: DressesTypeDataModel.Data.Subcategory.Item = subcategoryList.get(position)
            val viewHolder: RecyclerViewViewHolder = holder as RecyclerViewViewHolder
            viewHolder.bindItem(itemData)
            // Handle item selection
            viewHolder.itemView.setOnClickListener {
               selectedItemPosition(position)
            }
        }

        fun selectedItemPosition(position: Int){
            onClickEvent(subcategoryList.get(position),position) // Trigger click listener
        }

        fun updateSearchBy(searchBy:String) {
            currentSearchBy = searchBy
        }

        override fun getItemCount(): Int {
            return subcategoryList.size
        }

        fun updateNewList(newList:ArrayList<DressesTypeDataModel.Data.Subcategory.Item>){
            subcategoryList.clear()
            subcategoryList.addAll(newList)
            notifyDataSetChanged()
        }


        fun resetSelection() {
            val previousPosition = selectedPosition
            selectedPosition = -1
            if (previousPosition != -1) {
                notifyItemChanged(previousPosition) // Reset previous selection
            }
        }

        class RecyclerViewViewHolder(binding: ItemVastraBinding) :
            RecyclerView.ViewHolder(binding.getRoot()) {
            var binding: ItemVastraBinding

            init {
                this.binding = binding
            }

            fun bindItem(itemData: DressesTypeDataModel.Data.Subcategory.Item) {
//                binding.txtCatName.text = itemData.garmentid
                try {
                   /* val imageLoader = binding.imgVastraItem.context.imageLoader
                    val request = ImageRequest.Builder(binding.root.context)
                        .data(itemData.fullpath)
                        .target(binding.imgVastraItem)
                        .size(400, 400)
                        .build()
                    val disposable = imageLoader.enqueue(request)*/
                    Glide.with(binding.root.context)
                        .load(itemData.fullpath)
                        .thumbnail(0.1f)                // shows preview immediately
                        .diskCacheStrategy(DiskCacheStrategy.ALL)
                        .skipMemoryCache(false)
                        .dontAnimate()
                        .into(binding.imgVastraItem)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                val displayPrice = itemData.offerprice.takeIf { it.isNotBlank() && it != "0" }
                    ?: itemData.price.takeIf { it.isNotBlank() && it != "0" }
                binding.txtPrice.isVisible = displayPrice != null
                binding.txtPrice.text = displayPrice?.let { "\u20B9$it" }.orEmpty()
                binding.executePendingBindings()
            }
        }
    }


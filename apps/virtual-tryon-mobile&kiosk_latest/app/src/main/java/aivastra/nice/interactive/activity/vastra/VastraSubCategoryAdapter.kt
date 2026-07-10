package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ItemVastraCategoryBinding
import aivastra.nice.interactive.databinding.ItemVastraCategoryNewBinding
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
import com.example.facewixlatest.ApiUtils.APIConstant
import java.util.*
import kotlin.collections.ArrayList

class VastraSubCategoryAdapter(private val subcategoryList: ArrayList<DressesTypeDataModel.Data.Subcategory>,
                               private val onClickEvent:(DressesTypeDataModel.Data.Subcategory,Int)->Unit) : RecyclerView.Adapter<RecyclerView.ViewHolder>()
    {

        private var selectedPosition: Int = -1

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val binding: ItemVastraCategoryNewBinding = DataBindingUtil.inflate(
                LayoutInflater.from(parent.context),
                R.layout.item_vastra_category_new, parent, false
            )
            return  RecyclerViewViewHolder(binding)
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            val itemData: DressesTypeDataModel.Data.Subcategory = subcategoryList.get(position)
            val viewHolder: RecyclerViewViewHolder = holder as RecyclerViewViewHolder
            viewHolder.bindItem(itemData)
            // Change border based on selection
            if (position == selectedPosition) {
                viewHolder.binding.llMainItemview.setBackgroundResource(R.drawable.app_gradiant_square_bg)
            } else {
                viewHolder.binding.llMainItemview.setBackgroundResource(0)

            }
            // Handle item selection
            viewHolder.itemView.setOnClickListener {
                val previousPosition = selectedPosition
                selectedPosition = position
                notifyItemChanged(previousPosition) // Reset previous selection
                notifyItemChanged(selectedPosition) // Highlight current selection
               selectedItemPosition(position)
            }
        }

        fun selectedItemPosition(position: Int){
            onClickEvent(subcategoryList.get(position),position) // Trigger click listener
        }

        fun selectedItemPositionDefault(position: Int){
            selectedPosition = position
            notifyItemChanged(position)
            onClickEvent(subcategoryList.get(position),position) // Trigger click listener
        }

        override fun getItemCount(): Int {
            return subcategoryList.size
        }


        fun resetSelection() {
            val previousPosition = selectedPosition
            selectedPosition = -1
            if (previousPosition != -1) {
                notifyItemChanged(previousPosition) // Reset previous selection
            }
        }

        class RecyclerViewViewHolder(binding: ItemVastraCategoryNewBinding) :
            RecyclerView.ViewHolder(binding.getRoot()) {
            var binding: ItemVastraCategoryNewBinding

            init {
                this.binding = binding
            }

            fun bindItem(itemData: DressesTypeDataModel.Data.Subcategory) {
                binding.txtCatName.text = itemData.name
                binding.executePendingBindings()
            }
        }
    }


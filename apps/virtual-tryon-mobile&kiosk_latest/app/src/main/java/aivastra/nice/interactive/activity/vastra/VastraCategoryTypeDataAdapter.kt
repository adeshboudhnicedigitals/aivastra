package aivastra.nice.interactive.activity.vastra

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ItemVastraCategoryBinding
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import aivastra.nice.interactive.viewmodel.category.SareeCateDataModel
import android.app.Activity
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.databinding.DataBindingUtil
import androidx.recyclerview.widget.RecyclerView
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.example.facewixlatest.ApiUtils.APIConstant
import kotlin.collections.ArrayList

class VastraCategoryTypeDataAdapter(
    context: Activity, imageList: ArrayList<DressesTypeDataModel.Data>,
    private val clickListener: (DressesTypeDataModel.Data)->Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private var imagesList: ArrayList<DressesTypeDataModel.Data> = arrayListOf()
    private var activity: Activity? = null
    private var selectedPosition: Int = -1

    init {
        this.activity = context
        this.imagesList = imageList
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val binding: ItemVastraCategoryBinding = DataBindingUtil.inflate(
            LayoutInflater.from(parent.context),
            R.layout.item_vastra_category, parent, false
        )
        return RecyclerViewViewHolder(binding)
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val itemData: DressesTypeDataModel.Data = imagesList.get(position)
        val viewHolder: RecyclerViewViewHolder = holder as RecyclerViewViewHolder
        viewHolder.bindItem(itemData)
        // Change border based on selection
        if (position == selectedPosition) {
            viewHolder.binding.selectedBorder.isVisible = true
        } else {
            viewHolder.binding.selectedBorder.isVisible = false
        }

        // Handle item selection
        viewHolder.itemView.setOnClickListener {
            val previousPosition = selectedPosition
            selectedPosition = position
            notifyItemChanged(previousPosition) // Reset previous selection
            notifyItemChanged(selectedPosition) // Highlight current selection
            clickListener(itemData) // Trigger click listener
        }
    }

    override fun getItemCount(): Int {
        return imagesList.size
    }

    fun resetSelectionPosition(position: Int) {
        val previousPosition = selectedPosition
        selectedPosition = position
        if (previousPosition != -1) {
            notifyItemChanged(previousPosition) // Reset previous selection
        }
    }


    interface itemClickListener {
        fun itemClick(itemData: SareeCateDataModel.Data, position: Int)
    }

    class RecyclerViewViewHolder(binding: ItemVastraCategoryBinding) :
        RecyclerView.ViewHolder(binding.getRoot()) {
        var binding: ItemVastraCategoryBinding

        init {
            this.binding = binding
        }

        fun bindItem(itemData: DressesTypeDataModel.Data, ) {
            binding.txtCatName.text = itemData.categoryname
            val filePath = itemData.fullpath.split("/")
            val fileName = filePath.get(filePath.size - 1)
            val folderName = filePath.get(filePath.size - 2)
            try {
                val imageLoader = binding.icCategory.context.imageLoader
                val request = ImageRequest.Builder(binding.root.context)
                    .diskCachePolicy(CachePolicy.ENABLED)
                    .data(APIConstant.BASE_IMAGE_URL_TRYON + folderName + "/" + fileName)
                    .target(binding.icCategory)
                    .build()
                val disposable = imageLoader.enqueue(request)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            binding.executePendingBindings()
        }
    }
}


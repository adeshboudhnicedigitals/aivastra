package aivastra.nice.interactive.viewmodel.others

import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import androidx.recyclerview.widget.DiffUtil

class DiffVastraItemCallback :
    DiffUtil.ItemCallback<DressesTypeDataModel.Data.Subcategory.Item>() {

    override fun areItemsTheSame(
        oldItem: DressesTypeDataModel.Data.Subcategory.Item,
        newItem: DressesTypeDataModel.Data.Subcategory.Item
    ): Boolean {
        return oldItem.id == newItem.id // UNIQUE ID
    }

    override fun areContentsTheSame(
        oldItem: DressesTypeDataModel.Data.Subcategory.Item,
        newItem: DressesTypeDataModel.Data.Subcategory.Item
    ): Boolean {
        return oldItem == newItem
    }
}
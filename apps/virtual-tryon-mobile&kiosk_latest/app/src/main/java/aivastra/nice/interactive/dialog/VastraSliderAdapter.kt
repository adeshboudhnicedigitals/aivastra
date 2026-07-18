package aivastra.nice.interactive.dialog

import aivastra.nice.interactive.R
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.Dress.DressesTypeDataModel
import android.content.Context
import android.graphics.Paint
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy

class VastraSliderAdapter(
    private val context:Context,
    private val images: List<DressesTypeDataModel.Data.Subcategory.Item>
) : RecyclerView.Adapter<VastraSliderAdapter.Holder>() {

    inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val image: ImageView = view.findViewById(R.id.img_vastra_theme)
        val txtPrice: TextView = view.findViewById(R.id.txt_price)
        val txtOfferPrice: TextView = view.findViewById(R.id.txt_offer_price)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_slider_image, parent, false)
        return Holder(view)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        Glide.with(context)
            .load(images[position].preview)
            .thumbnail(0.1f)                // shows preview immediately
            .diskCacheStrategy(DiskCacheStrategy.ALL)
            .skipMemoryCache(false)
            .placeholder(ViewControll.setLoaderDrawble(context))
            .dontAnimate()
            .into(holder.image)
        val offerPrice = images[position].offerprice.takeIf { it.isNotBlank() && it != "0" }
        val actualPrice = images[position].price.takeIf { it.isNotBlank() && it != "0" }
        if (offerPrice != null && offerPrice != actualPrice) {
            holder.txtOfferPrice.text = "Price : \u20B9$offerPrice"
            holder.txtPrice.text = actualPrice?.let { "\u20B9$it" }.orEmpty()
            holder.txtPrice.paintFlags = holder.txtPrice.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
        } else {
            holder.txtOfferPrice.text = actualPrice?.let { "Price : \u20B9$it" }.orEmpty()
            holder.txtPrice.text = ""
        }

    }

    override fun getItemCount() = images.size
}
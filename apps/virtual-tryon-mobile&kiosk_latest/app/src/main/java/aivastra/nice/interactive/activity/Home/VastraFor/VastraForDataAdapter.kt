package aivastra.nice.interactive.activity.Home.VastraFor

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ItemVastraForBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.viewmodel.Dress.DressesForDataModel
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.view.animation.AnimationSet
import android.view.animation.AnimationUtils
import android.view.animation.RotateAnimation
import android.view.animation.ScaleAnimation
import android.widget.ImageView
import androidx.core.view.isVisible
import androidx.databinding.DataBindingUtil
import androidx.recyclerview.widget.RecyclerView
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import kotlin.collections.ArrayList

class VastraForDataAdapter(
    context: Activity, dressesForList: ArrayList<DressesForDataModel.Data>,
    private val clickListener: (DressesForDataModel.Data) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private var dressesForList: ArrayList<DressesForDataModel.Data> = arrayListOf()
    private var activity: Activity? = null
    private var recyclerViewHeight: Int = 0  // Store RecyclerView height

    init {
        this.activity = context
        this.dressesForList = dressesForList
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val binding: ItemVastraForBinding = DataBindingUtil.inflate(
            LayoutInflater.from(parent.context),
            R.layout.item_vastra_for, parent, false
        )
        return RecyclerViewViewHolder(binding)
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val itemData: DressesForDataModel.Data = dressesForList.get(position)
        val viewHolder: RecyclerViewViewHolder = holder as RecyclerViewViewHolder
        viewHolder.bindItem(itemData)
        // Handle item selection
       holder.binding.imgCard.setOnClickListener {
            clickListener(itemData) // Trigger click listener
        }
    }

    override fun getItemCount(): Int {
        return dressesForList.size
    }

    override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
        super.onViewRecycled(holder)
        if (holder is RecyclerViewViewHolder) {
            holder.binding.imgCircleAnimWomen.clearAnimation()
            holder.binding.imgCircleAnimMen.clearAnimation()
        }
    }

    fun setRecyclerViewHeight(height: Int) {
        recyclerViewHeight = height
        notifyDataSetChanged()  // Refresh items when height is set
    }

    class RecyclerViewViewHolder(binding: ItemVastraForBinding) :
        RecyclerView.ViewHolder(binding.getRoot()) {
        var binding: ItemVastraForBinding

        init {
            this.binding = binding
        }

        fun bindItem(itemData: DressesForDataModel.Data) {
            if(itemData.ctype.equals(AppConstant.MEN,true)||
                itemData.ctype.equals(AppConstant.BOY,true)){
                binding.llMenBoy.isVisible = true
                binding.llWomenGirl.isVisible = false
                binding.txtVastraFor.text = itemData.ctype
                if(itemData.ctype.equals(AppConstant.MEN,true)){
                    binding.imgVastraFor.setImageResource(R.drawable.men_category_img)
                }else{
                    binding.imgVastraFor.setImageResource(R.drawable.boy_category_img)
                }
                startAnimateCircleImage(binding.imgCircleAnimMen)

            }else if(itemData.ctype.equals(AppConstant.WOMEN,true)||
                itemData.ctype.equals(AppConstant.GIRL,true)){
                binding.llMenBoy.isVisible = false
                binding.llWomenGirl.isVisible = true
                binding.txtVastraForWomen.text = itemData.ctype
                if(itemData.ctype.equals(AppConstant.WOMEN,true)){
                    binding.imgVastraForWomen.setImageResource(R.drawable.women_category_img)
                }else{
                    binding.imgVastraForWomen.setImageResource(R.drawable.girl_category_img)
                }
                startAnimateCircleImage(binding.imgCircleAnimWomen)
            }
           /* try {
                val imageLoader = binding.imgCard.context.imageLoader
                val request = ImageRequest.Builder(binding.root.context)
                    .diskCachePolicy(CachePolicy.ENABLED)
                    .data(itemData.card_image)
                    .target(binding.imgCard)
                    .build()
                val disposable = imageLoader.enqueue(request)
            } catch (e: Exception) {
                e.printStackTrace()
            }*/
            binding.executePendingBindings()
        }

        fun startAnimateCircleImage(imageView:ImageView){
            val scaleAnim = ScaleAnimation(
                0.9f, 1.2f,  // fromX, toX
                0.9f, 1.2f,  // fromY, toY
                Animation.RELATIVE_TO_SELF, 0.5f,
                Animation.RELATIVE_TO_SELF, 0.5f
            ).apply {
                duration = 2500
                repeatCount = Animation.INFINITE
                repeatMode = Animation.REVERSE
            }

            val alphaAnim = AlphaAnimation(0.7f, 1f).apply {
                duration = 2500
                repeatCount = Animation.INFINITE
                repeatMode = Animation.REVERSE
            }

            // Rotate +90° to -90° (swing motion)
            val rotateAnim = RotateAnimation(
                -90f, 90f,
                Animation.RELATIVE_TO_SELF, 0.5f,
                Animation.RELATIVE_TO_SELF, 0.5f
            ).apply {
                duration = 4000
                repeatCount = Animation.INFINITE
                repeatMode = Animation.REVERSE
                interpolator = AccelerateDecelerateInterpolator()
            }

            val set = AnimationSet(true).apply {
                interpolator = AccelerateDecelerateInterpolator()
                addAnimation(scaleAnim)
                addAnimation(alphaAnim)
                addAnimation(rotateAnim)
            }

            imageView.startAnimation(set)
        }

    }

}


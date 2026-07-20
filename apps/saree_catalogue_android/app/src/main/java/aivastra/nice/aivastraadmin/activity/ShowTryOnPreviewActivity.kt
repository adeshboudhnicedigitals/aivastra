package aivastra.nice.aivastraadmin.activity

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.databinding.ActivityShowTryOnPreviewBinding
import aivastra.nice.aivastraadmin.utils.ViewControll
import android.view.View
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.bumptech.glide.request.RequestOptions

class ShowTryOnPreviewActivity : AppCompatActivity() {

    private lateinit var binding:ActivityShowTryOnPreviewBinding
    private var productImageUrl:String = ""
    private var productSkuNumber:String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityShowTryOnPreviewBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        productImageUrl = intent?.extras?.getString("productUrl").toString()
        productSkuNumber = intent?.extras?.getString("productSku").toString()
        try{
            Glide.with(this)
                .load(productImageUrl)
                .transition(DrawableTransitionOptions.withCrossFade(0))
                .placeholder(ViewControll.setLoaderDrawble(this))
                .apply(
                    RequestOptions()
                        .fitCenter()
                        .disallowHardwareConfig()   // Prevents flicker
                )
                .into(binding.photoview)

        }catch (e:Exception){
            e.printStackTrace()
        }
        binding.photoview.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        binding.txtSkunumber.text = productSkuNumber
        binding.imgCancel.setOnClickListener {
            onBackPressedDispatcher.onBackPressed()
        }
    }
}
package aivastra.nice.interactive.activity.vastra

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityVastraTryOnResultBinding
import aivastra.nice.interactive.utils.AppConstant
import aivastra.nice.interactive.utils.PrefsManager
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.animation.Animator
import android.content.Intent
import android.content.res.ColorStateList
import android.view.View
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable
import com.bumptech.glide.Glide
import com.example.facewixlatest.ApiUtils.APIConstant

class VastraTryOnResultActivity : BaseActivity(), View.OnClickListener {

    private lateinit var binding:ActivityVastraTryOnResultBinding
    private var tryOnResultUrl:String?=null
    private var tryOnResultId:String?=null
    private lateinit var sareeCatViewmodel: SareecategoryDataViewModel
    private var isProductLike = false
    private var isProductAddedToCart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityVastraTryOnResultBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        tryOnResultUrl = intent?.extras?.getString(AppConstant.TRY_ON_RESULT).toString()
        tryOnResultId = intent?.extras?.getString(AppConstant.TRY_ON_RESULT_ID).toString()
        try{
            Glide.with(this@VastraTryOnResultActivity)
                .load(tryOnResultUrl)
                .placeholder(ViewControll.setLoaderDrawble(this))
                .into(binding.imageTryOnResult)
        }catch(e:Exception){
            e.printStackTrace()
        }
        setMarchantCompanyLogo()
        binding.llLike.setOnClickListener(this)
        binding.llDownload.setOnClickListener(this)
        binding.llAddToCart.setOnClickListener(this)
        binding.imgBack.setOnClickListener(this)
    }

    private fun setMarchantCompanyLogo(){
        if(PrefsManager.isUserExist){
            val userData = PrefsManager.loginUserInfo
            if(userData.user.companyLogo.isNotEmpty()){
                try{
                    Glide.with(this@VastraTryOnResultActivity)
                        .load(userData.user.companyLogo)
                        .into(binding.imgMarchantLogo)
                }catch(e:Exception){
                    e.printStackTrace()
                }
            }
        }
    }

    private fun gotoNextScreen(tryOnResultUrl:String){
        val intent = Intent(this,ScanAndDownloadVastraResultActivity::class.java)
        intent.putExtra(AppConstant.TRY_ON_RESULT,tryOnResultUrl)
        intent.putExtra(AppConstant.TRY_ON_RESULT_ID,tryOnResultId)
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    override fun onClick(v: View?) {
        val id = v?.id
        if(id==R.id.ll_like){
            if(isProductLike){
                isProductLike = false
                tryOnResultId?.let { sareeCatViewmodel.likeVastraTryOnResultAPI(it,"0") }
                binding.llLike.imageTintList = null
            }else{
                isProductLike = true
                tryOnResultId?.let { sareeCatViewmodel.likeVastraTryOnResultAPI(it,"1") }
                binding.llLike.imageTintList = ColorStateList.valueOf(ContextCompat.getColor(this, R.color.red))
            }
        }
        if(id==R.id.ll_download){
            tryOnResultUrl?.let { gotoNextScreen(it) }
        }
        if(id==R.id.ll_add_to_cart){
            if(isProductAddedToCart){
                isProductAddedToCart = false
                tryOnResultId?.let { sareeCatViewmodel.addToCartVastraTryOnResultAPI(it,"0") }
                binding.llAddToCart.imageTintList = null
                ViewControll.showMessage(this,"Product removed from cart")
            }else{
                isProductAddedToCart = true
                tryOnResultId?.let { sareeCatViewmodel.addToCartVastraTryOnResultAPI(it,"1") }
                binding.llAddToCart.imageTintList = ColorStateList.valueOf(ContextCompat.getColor(this, R.color.dark_brown))
                ViewControll.showMessage(this,"Product added to cart")
            }
        }
        if(id==R.id.img_back){
            onBackPressedDispatcher.onBackPressed()
        }
    }
}
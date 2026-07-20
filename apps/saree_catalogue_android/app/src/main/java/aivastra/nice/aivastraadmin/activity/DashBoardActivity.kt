package aivastra.nice.aivastraadmin.activity

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import aivastra.nice.aivastraadmin.R
import aivastra.nice.aivastraadmin.databinding.ActivityDashBoardBinding
import aivastra.nice.aivastraadmin.fragment.ContactFragment
import aivastra.nice.aivastraadmin.fragment.UploadVastraFragment
import aivastra.nice.aivastraadmin.fragment.VastraProductCategoryFragment

import android.view.MenuItem
import androidx.activity.addCallback
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment

class DashBoardActivity : AppCompatActivity() {

    lateinit var binding: ActivityDashBoardBinding
    private lateinit var navController: NavController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDashBoardBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        // Setup Navigation Controller
        val navHostFragment =
            supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
        navController = navHostFragment.navController

        // Select Home tab by default
        binding.bottomNav.llBottomNav.selectedItemId = R.id.btn_upload_fragment

        binding.bottomNav.llBottomNav.setOnItemSelectedListener { item: MenuItem ->
            when (item.itemId) {
                R.id.btn_upload_fragment -> {
                    safeNavigate(R.id.uploadFragment)
                    true
                }
                R.id.btn_product_fragment -> {
                    safeNavigate(R.id.productsFragment)
                    true
                }
                R.id.btn_contact_fragment -> {
                    safeNavigate(R.id.contactFragment)
                    true
                }
                else -> false
            }
        }

        onBackPressedDispatcher.addCallback(this) {
            handleBackPress()
        }
    }

    private fun selectTab(itemId: Int) {
        binding.bottomNav.llBottomNav.selectedItemId = itemId
    }

    /** Prevents IllegalStateException crash when navigating to an already-visible destination */
    private fun safeNavigate(destinationId: Int) {
        try {
            if (navController.currentDestination?.id != destinationId) {
                navController.navigate(destinationId)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun handleBackPress() {
        val fragment = supportFragmentManager.findFragmentById(R.id.nav_host_fragment)
            ?.childFragmentManager?.fragments?.firstOrNull()

        when (fragment) {
            is ContactFragment -> {
                // Let WebView navigate back within its own history first
                if (fragment.canGoBack()) {
                    fragment.goBack()
                } else {
                    selectTab(R.id.btn_upload_fragment)
                    safeNavigate(R.id.uploadFragment)
                }
            }
            is UploadVastraFragment -> {
                fragment.handleBack()
            }
            is VastraProductCategoryFragment -> {
                selectTab(R.id.btn_upload_fragment)
                safeNavigate(R.id.uploadFragment)
            }
            else -> {
                if (!navController.popBackStack()) {
                    finish()
                }
            }
        }
    }

    fun navigateToProductFrag() {
        selectTab(R.id.btn_product_fragment)
        safeNavigate(R.id.productsFragment)
    }
}

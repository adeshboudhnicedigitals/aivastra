package aivastra.nice.interactive.activity.launch

import aivastra.nice.interactive.R
import aivastra.nice.interactive.databinding.ActivityAppOpenBinding
import aivastra.nice.interactive.utils.ViewControll
import aivastra.nice.interactive.viewmodel.category.SareecategoryDataViewModel
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.core.view.isVisible
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModelProvider
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.example.facewixlatest.ApiUtils.APIConstant

class AppOpenActivity : BaseActivity() {

    private lateinit var binding:ActivityAppOpenBinding
    private var exoPlayer: ExoPlayer? = null
    private lateinit var  sareeCatViewmodel : SareecategoryDataViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAppOpenBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        sareeCatViewmodel = ViewModelProvider(this).get(SareecategoryDataViewModel::class.java)
        ViewControll.setCompanyLogo(this,binding.appLogo)
//        loadSareeCategoryData()
//        playVideo()
    }

    @OptIn(UnstableApi::class)
    private fun playVideo(){
        exoPlayer = ExoPlayer.Builder(this).build()
        binding.playerView.player = exoPlayer
        binding.playerView.setKeepContentOnPlayerReset(true)

        // ✅ Use RawResourceDataSource instead of file
//        val rawAssetUri = RawResourceDataSource.buildRawResourceUri(R.raw.app_open_video)
//        val mediaItem = MediaItem.fromUri(rawAssetUri)
//        exoPlayer?.setMediaItem(mediaItem)

        exoPlayer?.repeatMode = ExoPlayer.REPEAT_MODE_OFF
        exoPlayer?.prepare()
        exoPlayer?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    binding.playerView.background = null
                    binding.playerView.isVisible = true
                    exoPlayer?.playWhenReady = true
                }
                if (playbackState == Player.STATE_ENDED) {
                    goToNextActivity()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                error.printStackTrace()
                Toast.makeText(this@AppOpenActivity, "Video playback error: ${error.message}", Toast.LENGTH_SHORT).show()
                goToNextActivity()
            }
        })
    }

    private fun goToNextActivity() {
        val intent = Intent(this@AppOpenActivity, SplashScreenActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        startActivity(intent)
        overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }

    private fun loadSareeCategoryData(){
        sareeCatViewmodel.fetchDressesForAPI()
        sareeCatViewmodel.dressesForData.observe(this, Observer { dressesForDataList ->

        })
        // Observe error LiveData
        sareeCatViewmodel.error.observe(this, Observer { error ->
            Log.e("SareeStudio",localClassName+" Error:="+error)
            Toast.makeText(this, APIConstant.errorSomethingWrong, Toast.LENGTH_SHORT).show()
            finish()
        })
    }

    override fun onPause() {
        super.onPause()
        exoPlayer?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        exoPlayer?.release()
        exoPlayer = null
    }
}
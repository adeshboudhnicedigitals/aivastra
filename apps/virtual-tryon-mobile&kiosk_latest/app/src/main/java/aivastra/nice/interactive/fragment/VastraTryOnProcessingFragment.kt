package aivastra.nice.interactive.fragment

import android.os.Bundle
import androidx.fragment.app.Fragment
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import aivastra.nice.interactive.R
import aivastra.nice.interactive.customview.TryOnProcessingVideoDownloader
import aivastra.nice.interactive.databinding.FragmentVastraTryOnProcessingBinding
import android.content.DialogInterface
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Shader
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.annotation.OptIn
import androidx.core.view.doOnAttach
import androidx.fragment.app.DialogFragment
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable

class VastraTryOnProcessingFragment : DialogFragment() {

    private lateinit var binding: FragmentVastraTryOnProcessingBinding
    private var exoPlayer: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var textRunnable: Runnable? = null
    private var lottieDrawable: LottieDrawable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NO_TITLE, R.style.Theme_AiVastra)
        isCancelable = false
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = FragmentVastraTryOnProcessingBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            setLayout(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        }
        // Removed system bar modification (causes relayout spike on kiosk)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
//        startLoaderAnimation()
//        startTextProcessAnimation()

        // 🚀 VERY IMPORTANT: Delay player init
        binding.root.postDelayed({
            startPlayerSafely()
        }, 150)
    }

    // ===========================
    // SAFE EXOPLAYER INIT
    // ===========================

    @OptIn(UnstableApi::class)
    private fun startPlayerSafely() {

        // postDelayed can fire after the dialog is dismissed (e.g. try-on flow already moved on),
        // leaving the fragment detached — requireContext()/requireActivity() would crash then.
        if (!isAdded || context == null) return

        if (exoPlayer != null) return

        exoPlayer = ExoPlayer.Builder(requireContext()).build()

        binding.playerView.apply {
            player = exoPlayer
            useController = false
            keepScreenOn = true
            setShutterBackgroundColor(Color.TRANSPARENT)
            setKeepContentOnPlayerReset(true)
        }

        val localFile = TryOnProcessingVideoDownloader.getLocalVideoFile(requireActivity())

        if (!localFile.exists() || localFile.length() <= 0) {
            startLoaderAnimation()
            startTextProcessAnimation()
            return
        }

        val mediaItem = MediaItem.fromUri(Uri.fromFile(localFile))

        exoPlayer?.apply {
            setMediaItem(mediaItem)
            repeatMode = Player.REPEAT_MODE_ONE
            playWhenReady = true
            prepare()
        }

        // ✅ Auto-recovery for Android 14 kiosk
        exoPlayer?.addListener(object : Player.Listener {

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying) {
                    exoPlayer?.play()
                }
            }

            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_IDLE -> {
                        exoPlayer?.prepare()
                        exoPlayer?.play()
                    }
                    Player.STATE_ENDED -> {
                        exoPlayer?.seekTo(0)
                        exoPlayer?.play()
                    }
                }
            }
        })
    }

    // ===========================
    // LOTTIE
    // ===========================

    private fun startLoaderAnimation() {
        lottieDrawable = LottieDrawable()
        val composition = LottieCompositionFactory
            .fromRawResSync(requireContext(), R.raw.star_loader_animation)
            .value

        lottieDrawable?.apply {
            this.composition = composition
            repeatMode = LottieDrawable.RESTART
            repeatCount = LottieDrawable.INFINITE
            playAnimation()
        }

        binding.lottieView.setImageDrawable(lottieDrawable)
    }

    // ===========================
    // TEXT ANIMATION (LIGHTER)
    // ===========================

    private fun startTextProcessAnimation() {

        val messages = listOf(
            "🧵 Setting up your style…",
            "💃 Matching perfect drape to your body shape…",
            "🎨 Adding finishing details…",
            "👗 Styling you virtually…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…"
        )

        var index = 0

        textRunnable = object : Runnable {
            override fun run() {

                binding.loadingText.text = messages[index]

                binding.loadingText.alpha = 0f
                binding.loadingText.animate()
                    .alpha(1f)
                    .setDuration(800)
                    .start()

                index = (index + 1) % messages.size
                handler.postDelayed(this, 2500)
            }
        }

        handler.post(textRunnable!!)
    }

    // ===========================
    // SAFE DISMISS
    // ===========================

    fun dismissDialogSafe() {
        try {
            exoPlayer?.pause()
            stopLottieAnimation()
            textRunnable?.let { handler.removeCallbacks(it) }
            dismissAllowingStateLoss()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

   /* override fun onPause() {
        super.onPause()
        exoPlayer?.pause()
    }*/

    override fun onDestroyView() {
        super.onDestroyView()
        stopLottieAnimation()
        textRunnable?.let { handler.removeCallbacks(it) }
        releasePlayer()
    }

    private fun stopLottieAnimation() {
        lottieDrawable?.cancelAnimation()
        lottieDrawable = null
    }

    private fun releasePlayer() {
        exoPlayer?.release()
        exoPlayer = null
    }

    companion object {
        fun newInstance() = VastraTryOnProcessingFragment()
    }
}

/*
class VastraTryOnProcessingFragment : DialogFragment() {

    private lateinit var binding: FragmentVastraTryOnProcessingBinding
    private var exoPlayer: ExoPlayer? = null
    private var handler = Handler(Looper.getMainLooper())
    private var textRunnable: Runnable? = null
    private var lottieDrawable: LottieDrawable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NO_TITLE, R.style.Theme_AiVastra)
        isCancelable = false
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        binding = FragmentVastraTryOnProcessingBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            setLayout(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        }
        makeBarsTransparentAndVisible()
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initView()
    }

    @OptIn(UnstableApi::class)
    private fun initView() {
        startLoaderAnimation()
        startTextProcessAnimation()
        binding.playerView.doOnAttach {
            playVideo()
        }
    }


    @androidx.annotation.OptIn(UnstableApi::class)
    private fun playVideo() {
        if (exoPlayer != null) return
        exoPlayer = ExoPlayer.Builder(requireContext()).build()
        binding.playerView.apply {
//            player = exoPlayer
            useController = false
            keepScreenOn = true
            setShutterBackgroundColor(Color.TRANSPARENT)
//            visibility = View.VISIBLE
        }
        exoPlayer?.apply {
            setMediaItem(
                MediaItem.fromUri(Uri.EMPTY)
            )
            repeatMode = Player.REPEAT_MODE_ALL
            prepare()
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_READY) {
                        binding.playerView.apply {
                            player = exoPlayer
                            visibility = View.VISIBLE
                        }
                        playWhenReady = true
                    }
                }
            })
        }
    }

    private fun startLoaderAnimation() {
        lottieDrawable = LottieDrawable()
        val composition = LottieCompositionFactory
            .fromRawResSync(requireContext(), R.raw.star_loader_animation)
            .value

        lottieDrawable?.apply {
            this.composition = composition
            repeatMode = LottieDrawable.REVERSE
            repeatCount = LottieDrawable.INFINITE
            playAnimation()
        }

        binding.lottieView.setImageDrawable(lottieDrawable)
    }

    fun dismissDialogSafe() {
        if (!isAdded) return

        val activity = activity ?: return

        activity.runOnUiThread {
            try {
                exoPlayer?.pause()
                stopLottieAnimation()

                // 1️⃣ Dismiss window directly (works on Android 8/9)
                dialog?.setOnDismissListener(null)
                if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                    // Android 9 and below
                    activity.window.decorView.post {
                        dialog?.dismiss()
                    }
                } else {
                    dialog?.dismiss()
                }

                // 2️⃣ Backup Fragment dismiss (for newer versions)
                if (!isRemoving) {
                    dismissAllowingStateLoss()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun startTextProcessAnimation(){
        val messages = listOf(
            "🧵 Setting up your style…",
            "💃 Matching perfect drape to your body shape…",
            "🎨 Adding finishing details…",
            "👗 Styling you virtually…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…",
            "💫 Almost done! Your look is ready…"
        )

        handler = Handler(Looper.getMainLooper())
        var index = 0

        textRunnable = object : Runnable {
            override fun run() {
                val textView = binding.loadingText
                textView.text = messages[index]

                // Gradient each time to reset width
                textView.post {
                    val paint = textView.paint
                    val width = paint.measureText(textView.text.toString())
                    val shader = LinearGradient(
                        0f, 0f, width, textView.textSize,
                        intArrayOf(requireActivity().getColor(R.color.gradiant1),
                            requireActivity().getColor(R.color.gradiant2),
                            requireActivity().getColor(R.color.gradiant3)
                        ),
                        null,
                        Shader.TileMode.CLAMP
                    )
                    textView.paint.shader = shader
                    textView.invalidate()
                }

                // Simple fade animation
                textView.alpha = 0f
                textView.animate().alpha(1f).setDuration(2000).start()

                index = (index + 1) % messages.size
                handler.postDelayed(this, 5000)
            }
        }
        handler.post(textRunnable!!)
    }

    override fun onPause() {
        super.onPause()
        exoPlayer?.pause()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        stopLottieAnimation()
        textRunnable?.let { handler.removeCallbacks(it) }
    }

    override fun onDestroy() {
        super.onDestroy()
        releasePlayer()
    }


    private fun stopLottieAnimation() {
        lottieDrawable?.cancelAnimation()
        lottieDrawable?.clearComposition()
        lottieDrawable = null
    }

    private fun releasePlayer() {
        exoPlayer?.run {
            stop()
            release()
        }
        exoPlayer = null
    }

    private fun makeBarsTransparentAndVisible() {
        val window = dialog?.window

        // ✅ Make status & nav bars transparent
        window?.statusBarColor = Color.TRANSPARENT
        window?.navigationBarColor = Color.TRANSPARENT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // ✅ Android 11+
            val controller = window?.insetsController
            controller?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            // ✅ Android 10 and below
            window?.decorView?.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    companion object {
        @JvmStatic
        fun newInstance() = VastraTryOnProcessingFragment()
    }
}*/

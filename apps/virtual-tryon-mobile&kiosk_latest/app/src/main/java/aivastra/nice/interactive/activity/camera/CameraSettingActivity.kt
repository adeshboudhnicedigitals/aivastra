package aivastra.nice.interactive.activity.camera

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.launch.BaseActivity
import aivastra.nice.interactive.databinding.ActivityCameraSettingBinding
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.dialog.ShowErrorAlertDialog
import aivastra.nice.interactive.utils.PrefsManager
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.widget.ArrayAdapter
import androidx.activity.OnBackPressedCallback
import androidx.core.view.isVisible
import com.otaliastudios.cameraview.CameraListener
import com.otaliastudios.cameraview.CameraOptions
import com.otaliastudios.cameraview.CameraView
import com.otaliastudios.cameraview.controls.Engine
import com.otaliastudios.cameraview.controls.Facing
import com.otaliastudios.cameraview.controls.Flash
import com.otaliastudios.cameraview.controls.Hdr
import com.otaliastudios.cameraview.controls.Preview
import com.otaliastudios.cameraview.controls.WhiteBalance
import com.otaliastudios.cameraview.size.Size

class CameraSettingActivity : BaseActivity() {

    private lateinit var binding:ActivityCameraSettingBinding
    private var sizeList: List<Size> = listOf()
    private var initialFlash = ""
    private var initialWb = ""
    private var initialEngine = ""
    private var initialPreview = ""
    private var initialFacing = ""
    private var initialHdr = false
    private var initialOrientation = false
    private var initialWidth = 0
    private var initialHeight = 0
    private var showAppAlertDialog : ShowAppAlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCameraSettingBinding.inflate(layoutInflater)
        setContentView(binding.root)
        initView()
    }

    private fun initView() {
        binding.camera.addCameraListener(object : CameraListener() {
            override fun onCameraOpened(options: CameraOptions) {
                setupUI(options)
            }
        })
        binding.llToolbar.imgBack.setOnClickListener{
            onBackPressedDispatcher.onBackPressed()
        }
        onSaveButtonClick()
        backPressCallback()
    }

    private fun setupUI(options: CameraOptions) {

        // ================= SUPPORTED CAMERA =================
        val facingList = options.supportedFacing.toList()
        val facingNameList = facingList.map {
            when (it) {
                Facing.BACK -> "Back Camera"
                Facing.FRONT -> "Front Camera"
                else -> "External / USB Camera"
            }
        }
        binding.spinnerSupportedCamera.adapter = ArrayAdapter(this, R.layout.item_spinner_text, facingNameList)
        val currentFacing = PrefsManager.getString(PrefsManager.KEY_SUPPORTED_CAMERA,binding.camera.facing.name)
        val facing = when(currentFacing){
            "Back Camera" -> Facing.BACK
            "Front Camera" -> Facing.FRONT
            else -> Facing.BACK
        }
        val facingPosition = facingList.indexOf(facing)
        if (facingPosition >= 0) {
            binding.spinnerSupportedCamera.setSelection(facingPosition)
        }

        // ================= FLASH =================
        if (options.supportedFlash.isEmpty()) {
            binding.llFlash.isVisible = false
        }else{
            binding.spinnerFlash.adapter = ArrayAdapter(this, R.layout.item_spinner_text, options.supportedFlash.toList())
            val currentFlash = Flash.valueOf(PrefsManager.getString(PrefsManager.KEY_FLASH, binding.camera.flash.name).toString())
            val flashPosition = options.supportedFlash.toList().indexOf(currentFlash)
            if (flashPosition >= 0) {
                binding.spinnerFlash.setSelection(flashPosition)
            }
        }

        // ================= HDR =================
        val currentHdr = Hdr.valueOf(PrefsManager.getString(PrefsManager.KEY_HDR, Hdr.OFF.name).toString())
        if(currentHdr.equals(Hdr.ON)){
            binding.switchHdr.isChecked = true
        }else{
            binding.switchHdr.isChecked = false
        }

        // ================= User Orientation =================
        val currentOrientation = PrefsManager.getBoolean(PrefsManager.KEY_ORIENTATION)
        binding.switchOrientation.isChecked = currentOrientation

        // ================= WHITE BALANCE =================
        binding.llWhitebalance.isVisible = options.supportedWhiteBalance.size > 1
        binding.spinnerWhiteBalance.adapter = ArrayAdapter(this, R.layout.item_spinner_text, options.supportedWhiteBalance.toList())
        val currentWb = WhiteBalance.valueOf(PrefsManager.getString(PrefsManager.KEY_WB, binding.camera.whiteBalance.name).toString())
        binding.spinnerWhiteBalance.setSelection(options.supportedWhiteBalance.toList().indexOf(currentWb))

        // ================= ENGINE =================
        val engineList = mutableListOf<Engine>()
        engineList.add(Engine.CAMERA1)

        // Check if Camera2 supported
        if (hasCamera2(this)) {
            engineList.add(Engine.CAMERA2)
        }

        binding.spinnerEngine.adapter = ArrayAdapter(this, R.layout.item_spinner_text, engineList)
        val currentEngine = Engine.valueOf(PrefsManager.getString(PrefsManager.KEY_ENGINE, binding.camera.engine.name).toString())
        val enginePosition = engineList.indexOf(currentEngine)
        if (enginePosition >= 0) {
            binding.spinnerEngine.setSelection(enginePosition)
        }

        // ================= PREVIEW =================
        val previewList = listOf(
            Preview.TEXTURE,
            Preview.SURFACE,
            Preview.GL_SURFACE
        )

        binding.spinnerPreviewType.adapter = ArrayAdapter(this, R.layout.item_spinner_text, previewList)
        val currentPreview = Preview.valueOf(PrefsManager.getString(PrefsManager.KEY_PREVIEW, binding.camera.preview.name).toString())
        val previewPosition = previewList.indexOf(currentPreview)
        if (previewPosition >= 0) {
            binding.spinnerPreviewType.setSelection(previewPosition)
        }

        // ================= RESOLUTION =================
        sizeList = options.supportedPictureSizes.toList()
        val sizeNameList = sizeList.map { "${it.width} x ${it.height}" }
        binding.spinnerPictureSize.adapter = ArrayAdapter(this, R.layout.item_spinner_text, sizeNameList)
        val width = PrefsManager.getInt(PrefsManager.KEY_PIC_WIDTH, 0)
        val height = PrefsManager.getInt(PrefsManager.KEY_PIC_HEIGHT, 0)

        val position = if (width > 0 && height > 0) {
            // find saved resolution in list
            sizeList.indexOfFirst {
                it.width == width && it.height == height
            }
        } else {
            // fallback → camera current resolution
            val currentSize = binding.camera.pictureSize
            sizeList.indexOfFirst {
                it.width == currentSize?.width && it.height == currentSize?.height
            }
        }
        // apply selection
        if (position >= 0) {
            binding.spinnerPictureSize.setSelection(position)
        } else {
            binding.spinnerPictureSize.setSelection(0) // default first resolution
        }
        saveInitialState()
    }

    private fun saveInitialState() {
        initialFlash = binding.spinnerFlash.selectedItem?.toString() ?: ""
        initialWb = binding.spinnerWhiteBalance.selectedItem?.toString() ?: ""
        initialEngine = binding.spinnerEngine.selectedItem?.toString() ?: ""
        initialPreview = binding.spinnerPreviewType.selectedItem?.toString() ?: ""
        initialFacing = binding.spinnerSupportedCamera.selectedItem?.toString() ?: ""
        initialHdr = binding.switchHdr.isChecked
        initialOrientation = binding.switchOrientation.isChecked

        val size = sizeList.getOrNull(binding.spinnerPictureSize.selectedItemPosition)
        initialWidth = size?.width ?: 0
        initialHeight = size?.height ?: 0
    }

    private fun isSettingChanged(): Boolean {

        val currentFlash = binding.spinnerFlash.selectedItem?.toString() ?: ""
        val currentWb = binding.spinnerWhiteBalance.selectedItem?.toString() ?: ""
        val currentEngine = binding.spinnerEngine.selectedItem?.toString() ?: ""
        val currentPreview = binding.spinnerPreviewType.selectedItem?.toString() ?: ""
        val currentFacing = binding.spinnerSupportedCamera.selectedItem?.toString() ?: ""

        val currentHdr = binding.switchHdr.isChecked
        val currentOrientation = binding.switchOrientation.isChecked

        val size = sizeList.getOrNull(binding.spinnerPictureSize.selectedItemPosition)
        val width = size?.width ?: 0
        val height = size?.height ?: 0

        return initialFlash != currentFlash ||
                initialWb != currentWb ||
                initialEngine != currentEngine ||
                initialPreview != currentPreview ||
                initialFacing != currentFacing ||
                initialHdr != currentHdr ||
                initialOrientation != currentOrientation ||
                initialWidth != width ||
                initialHeight != height
    }

    private fun hasCamera2(context: Context): Boolean {
        return try {
            val manager =
                context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            for (id in manager.cameraIdList) {
                val characteristics =
                    manager.getCameraCharacteristics(id)
                val level = characteristics.get(
                    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL
                )
                if (level != null && level != CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
                    return true
                }
            }
            false
        } catch (e: Exception) {
            false
        }
    }
    
    private fun onSaveButtonClick(){
        binding.btnSave.setOnClickListener {

            PrefsManager.putString(PrefsManager.KEY_FLASH, binding.spinnerFlash.selectedItem.toString())

            PrefsManager.putString(PrefsManager.KEY_WB, binding.spinnerWhiteBalance.selectedItem.toString())

            PrefsManager.putString(PrefsManager.KEY_ENGINE, binding.spinnerEngine.selectedItem.toString())

            PrefsManager.putString(PrefsManager.KEY_PREVIEW, binding.spinnerPreviewType.selectedItem.toString())

            // ✅ Save resolution properly
            val position = binding.spinnerPictureSize.selectedItemPosition
            val selectedSize = sizeList[position]

            PrefsManager.putInt(PrefsManager.KEY_PIC_WIDTH, selectedSize.width)
            PrefsManager.putInt(PrefsManager.KEY_PIC_HEIGHT, selectedSize.height)

            PrefsManager.putString(PrefsManager.KEY_SUPPORTED_CAMERA, binding.spinnerSupportedCamera.selectedItem.toString())

            PrefsManager.putString(PrefsManager.KEY_HDR, if (binding.switchHdr.isChecked) Hdr.ON.name else Hdr.OFF.name)

            PrefsManager.putBoolean(PrefsManager.KEY_ORIENTATION, binding.switchOrientation.isChecked)
            PrefsManager.putBoolean(PrefsManager.SETTING_CHANGED, true)
            finish()
        }
    }

    private fun backPressCallback(){
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Back press logic
                if (isSettingChanged()) {
                    if(showAppAlertDialog?.isAdded == true){
                        return
                    }
                    // prevent state crash
                    if (supportFragmentManager.isStateSaved) {
                        return
                    }
                     showAppAlertDialog = ShowAppAlertDialog(
                        ShowAppAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_setting),
                        getString(R.string.unsaved_changes),
                        getString(R.string.setting_not_saved_alert),
                        getString(R.string.stay),
                        getString(R.string.leave)){
                         showAppAlertDialog?.dismiss()
                         finish()
                    }
                    showAppAlertDialog?.show(supportFragmentManager,"ShowErrorAlertDialog")
                }else{
                    finish()
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, callback)
    }

    override fun onResume() {
        super.onResume()
        binding.camera.open()
    }

    override fun onPause() {
        binding.camera.close()
        super.onPause()
    }
}
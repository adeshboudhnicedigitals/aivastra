package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.net.toUri
import androidx.exifinterface.media.ExifInterface
import com.otaliastudios.cameraview.CameraListener
import com.otaliastudios.cameraview.CameraOptions
import com.otaliastudios.cameraview.CameraView
import com.otaliastudios.cameraview.PictureResult
import com.otaliastudios.cameraview.controls.Audio
import com.otaliastudios.cameraview.controls.Flash
import com.otaliastudios.cameraview.controls.Hdr
import com.otaliastudios.cameraview.controls.Mode
import com.otaliastudios.cameraview.controls.PictureFormat
import com.otaliastudios.cameraview.controls.Preview
import com.otaliastudios.cameraview.filter.NoFilter
import java.io.File
import java.io.FileOutputStream

class UniversalCameraController(
    private val activity: AppCompatActivity,
    private val cameraView: CameraView
) {

    fun setup() {
        cameraView.setLifecycleOwner(activity)

        cameraView.apply {
            mode = Mode.PICTURE
            pictureFormat = PictureFormat.JPEG
            audio = Audio.OFF

            // ❌ Never rotate camera frames
            rotation = 0f
            useDeviceOrientation = false

            // ❌ USB cameras don’t support these reliably
            hdr = Hdr.OFF
            flash = Flash.OFF
            filter = NoFilter()

            preview = Preview.GL_SURFACE
        }

        applyPreviewRotation()
        logMaxPictureSize()
    }

    /**
     * Rotate ONLY preview for kiosk USB cameras
     */
    private fun applyPreviewRotation() {
        cameraView.post {
            cameraView.rotation = if (isUsbKiosk(activity)) 180f else 0f
        }
    }

    /**
     * Detect USB / kiosk environment
     */
    private fun isUsbKiosk(context: Context): Boolean {
        return context.packageManager.hasSystemFeature("android.hardware.usb.host")
    }

    /**
     * Capture image safely
     */
    fun takePicture(onResult: (Uri) -> Unit) {
        cameraView.takePictureSnapshot()
        cameraView.addCameraListener(object : CameraListener() {
            override fun onPictureTaken(result: PictureResult) {
                result.toFile(
                    File(
                        activity.cacheDir,
                        "IMG_${System.currentTimeMillis()}.jpg"
                    )
                ) { file ->
                    val fixed = file?.let { fixExifRotation(activity, it) }
                    if (fixed != null) {
                        onResult(fixed)
                    }
                }
            }
        })
    }

    /**
     * Log REAL camera resolution (important for kiosks)
     */
    private fun logMaxPictureSize() {
        cameraView.addCameraListener(object : CameraListener() {
            override fun onCameraOpened(options: CameraOptions) {
              /*  val size = options.pictureSizes
                    .maxByOrNull { it.width * it.height }

                Log.e(
                    "UNIVERSAL_CAMERA",
                    "Max picture size = ${size?.width} x ${size?.height}"
                )*/
            }
        })
    }

    /**
     * Fix rotation ONLY if Exif says so
     * (No double rotation, no quality loss)
     */
    private fun fixExifRotation(context: Context, file: File): Uri {
        val exif = ExifInterface(file)
        val orientation = exif.getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL
        )

        val rotation = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }

        if (rotation == 0) return file.toUri()

        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
        val matrix = Matrix().apply { postRotate(rotation.toFloat()) }

        val rotated = Bitmap.createBitmap(
            bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true
        )

        val outFile = File(
            context.cacheDir,
            "FIXED_${System.currentTimeMillis()}.jpg"
        )

        FileOutputStream(outFile).use {
            rotated.compress(Bitmap.CompressFormat.JPEG, 100, it)
        }

        return outFile.toUri()
    }
}
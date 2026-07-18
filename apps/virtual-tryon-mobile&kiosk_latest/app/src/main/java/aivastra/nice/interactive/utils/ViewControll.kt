package aivastra.nice.interactive.utils

import aivastra.nice.interactive.R
import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.ImageView
import android.widget.RelativeLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.ContextCompat.getColor
import androidx.core.view.isVisible
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.CircularProgressDrawable
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.google.android.material.snackbar.Snackbar
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import com.journeyapps.barcodescanner.BarcodeEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream

object ViewControll {
    private var dialog: Dialog? = null

    // Toast has no API for a custom duration (only LENGTH_SHORT ~2s / LENGTH_LONG ~3.5s), so a
    // ~10s hold is done by re-showing the same Toast before its current display expires.
    private const val TOAST_TOTAL_DURATION_MS = 10_000L
    private const val TOAST_REFRESH_INTERVAL_MS = 3_000L

    fun showMessage(activity: Activity, message: String) {
        val toast = Toast.makeText(activity, message, Toast.LENGTH_LONG)
        toast.show()
        val handler = Handler(Looper.getMainLooper())
        var elapsedMs = 0L
        val refresher = object : Runnable {
            override fun run() {
                elapsedMs += TOAST_REFRESH_INTERVAL_MS
                if (elapsedMs < TOAST_TOTAL_DURATION_MS) {
                    toast.show()
                    handler.postDelayed(this, TOAST_REFRESH_INTERVAL_MS)
                }
            }
        }
        handler.postDelayed(refresher, TOAST_REFRESH_INTERVAL_MS)
    }

    fun convertStringToRequestBody(itemValue: String): RequestBody {
        return itemValue.toRequestBody("multipart/form-data".toMediaTypeOrNull())
    }

    fun hideKeyboard(activity: Activity) {
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val view = activity.currentFocus ?: View(activity) // Fallback to a new View if no focus
        imm.hideSoftInputFromWindow(view.windowToken, 0)
    }


    fun checkStoragePermission(activity: Activity): Boolean {
        return if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) { // Android 9 and below
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 101)
                false
            } else {
                true
            }
        } else {
            true // No permission needed for Android 10+
        }
    }

  /*  fun showPhotoSaveDialog(activity: Activity, txt_message: String) {
        dialog = Dialog(activity)
        dialog?.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog?.setCancelable(false)
        dialog?.setCanceledOnTouchOutside(false)
        dialog?.setContentView(R.layout.popup_save_photo)
        val txtMessage = dialog?.findViewById<View>(R.id.tv_title) as TextView
        txtMessage.text = txt_message
        dialog?.getWindow()?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog?.getWindow()?.setDimAmount(0.70f)
        if (activity.isFinishing) {
            return
        }
        dialog?.show()
    }*/

    fun hideDialog() {
        try {
            if(dialog != null && dialog?.isShowing() == true) {
                dialog?.dismiss()
                dialog = null
            }
        }catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun setCompanyLogo(activity: Context,imageView: ImageView){
        try{
            Glide.with(activity)
                .load(PrefsManager.loginUserInfo.user.companyLogo)
                .placeholder(R.drawable.app_logo_vertical)
                .error(R.drawable.app_logo_vertical)
                .into(imageView)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    fun setCompanyLogoHorizontal(activity: Context,imageView: ImageView){
        try{
            Glide.with(activity)
                .load(PrefsManager.loginUserInfo.user.companyLogo)
                .placeholder(R.drawable.logo_horizontal)
                .error(R.drawable.logo_horizontal)
                .into(imageView)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    fun clearAppCache(context: Context) {
        try {
            context.cacheDir.deleteRecursively()
            context.codeCacheDir.deleteRecursively()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun clearTryOnCameraCache(context: Context) {
        try {
            val dir = File(context.externalCacheDir, "AiVastraCamera")
            if (dir != null && dir.exists() && dir.isDirectory) {
                dir.listFiles()?.forEach { file ->
                    try {
                        file.delete()
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
                dir.delete()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun diableActivityClick(activity: Activity){
        activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
    }

    fun enableActivityClick(activity: Activity){
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
    }


    fun setLoaderDrawble(activity: Context): Drawable {
        val drawable = CircularProgressDrawable(activity)
        drawable.setColorSchemeColors(
            activity.getColor(R.color.gradiant1),
            activity.getColor(R.color.gradiant2),
            activity.getColor(R.color.gradiant3),
            activity.getColor(R.color.gradiant4),
            activity.getColor(R.color.gradiant5)
        )
        drawable.centerRadius = 30f
        drawable.strokeWidth = 5f
        drawable.start()
        return drawable
    }

    fun saveBitmapToFile(context: Context, bitmap: Bitmap, fileName: String = "glide_image_${System.currentTimeMillis()}.jpg"): File? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ Scoped Storage
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AiVastra")
                }
                val uri: Uri? = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                uri?.let {
                    context.contentResolver.openOutputStream(it)?.use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
                    }
                    // Optional: Return temporary file reference for next flow
                    val tempFile = File(context.cacheDir, fileName)
                    FileOutputStream(tempFile).use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
                    }
                    tempFile
                }
            } else {
                // Android 9 and below
                val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                val targetDir = File(picturesDir, "VirtualTryOn")
                if (!targetDir.exists()) targetDir.mkdirs()
                val imageFile = File(targetDir, fileName)
                FileOutputStream(imageFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out)
                }
                imageFile
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun getBitmapFromGlide(context: Context, imageUrl: String): Bitmap? {
        return try {
            Glide.with(context)
                .asBitmap()
                .load(imageUrl)
                .diskCacheStrategy(DiskCacheStrategy.ALL)
                .submit()
                .get()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun generateQRCodeFromText(content: String): Bitmap? {
        return try {
            val bitMatrix: BitMatrix = MultiFormatWriter().encode(content, BarcodeFormat.QR_CODE, 650, 650)

            // Remove white padding (find the first and last black pixel)
            val width = bitMatrix.width
            val height = bitMatrix.height
            var minX = width
            var minY = height
            var maxX = 0
            var maxY = 0

            for (x in 0 until width) {
                for (y in 0 until height) {
                    if (bitMatrix[x, y]) {
                        if (x < minX) minX = x
                        if (y < minY) minY = y
                        if (x > maxX) maxX = x
                        if (y > maxY) maxY = y
                    }
                }
            }

            // Create a new BitMatrix without padding
            val newWidth = maxX - minX + 1
            val newHeight = maxY - minY + 1
            val trimmedMatrix = BitMatrix(newWidth, newHeight)
            for (x in 0 until newWidth) {
                for (y in 0 until newHeight) {
                    if (bitMatrix[x + minX, y + minY]) {
                        trimmedMatrix.set(x, y)
                    }
                }
            }

            val barcodeEncoder = BarcodeEncoder()
            barcodeEncoder.createBitmap(trimmedMatrix)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }


    fun showSnackErrorMsg(activity: Activity,erroMsg:String,onOkClick: (() -> Unit)? = null){
       if (activity.isFinishing || activity.isDestroyed) return

        val snackbar = Snackbar.make(
            activity.findViewById(android.R.id.content),
            erroMsg,
            Snackbar.LENGTH_INDEFINITE
        )
        val textView =
            snackbar.view.findViewById<TextView>(com.google.android.material.R.id.snackbar_text)
        textView.maxLines = Int.MAX_VALUE
        textView.ellipsize = null
        textView.setTextColor(Color.BLACK)

        snackbar.setBackgroundTint(Color.LTGRAY)
        snackbar.setActionTextColor(Color.BLACK)

        snackbar.setAction("OK") {
            snackbar.dismiss()
            onOkClick?.invoke()
        }
        snackbar.show()
    }

}

package aivastra.nice.interactive.customview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File

object UniversalRotationManager {

    private const val PREF = "universal_rotation"
    private const val KEY_KIOSK_ROTATION = "kiosk_rotation"

    // ---------- STORAGE ----------
    private fun prefs(context: Context) =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    private fun saveKioskRotation(context: Context, rotation: Int) {
        prefs(context).edit().putInt(KEY_KIOSK_ROTATION, rotation).apply()
    }

    private fun getKioskRotation(context: Context): Int =
        prefs(context).getInt(KEY_KIOSK_ROTATION, -1)

    // ---------- MAIN ENTRY ----------
    fun processBitmap(
        context: Context,
        bitmap: Bitmap,
        imageFile: File
    ): Bitmap {

        // 1️⃣ Try EXIF (mobile / tablet)
        val exifRotation = getExifRotation(imageFile)
        if (exifRotation != 0) {
            return rotate(bitmap, exifRotation)
        }

        // 2️⃣ Kiosk: detect once using bitmap ratio
        val kioskRotation = detectOrGetKioskRotation(context, bitmap)
        if (kioskRotation != 0) {
            return rotate(bitmap, kioskRotation)
        }

        // 3️⃣ No rotation needed
        return bitmap
    }

    // ---------- EXIF ----------
    private fun getExifRotation(file: File): Int {
        return try {
            val exif = ExifInterface(file.absolutePath)
            when (exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        } catch (e: Exception) {
            0
        }
    }

    // ---------- KIOSK ----------
    private fun detectOrGetKioskRotation(context: Context, bitmap: Bitmap): Int {
        val saved = getKioskRotation(context)
        if (saved != -1) return saved

        val rotation = if (bitmap.width > bitmap.height) {
            // landscape sensor, portrait UI (MOST kiosks)
            270
        } else {
            0
        }

        saveKioskRotation(context, rotation)
        return rotation
    }

    // ---------- ROTATE ----------
    private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(
            bitmap, 0, 0,
            bitmap.width, bitmap.height,
            matrix, true
        )
    }
}
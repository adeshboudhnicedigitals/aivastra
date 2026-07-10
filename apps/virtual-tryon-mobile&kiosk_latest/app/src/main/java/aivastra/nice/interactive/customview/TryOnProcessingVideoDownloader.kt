package aivastra.nice.interactive.customview

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.URL

object TryOnProcessingVideoDownloader {

    private const val FILE_NAME = "TryOnProcessing_Video.mp4"

    suspend fun ensureVideoDownloaded(
        context: Context,
        videoUrl: String
    ): File? {

        return withContext(Dispatchers.IO) {

            try {
                val file = File(context.filesDir, FILE_NAME)

                // ✅ Already exists and valid
                if (file.exists() && file.length() > 0) {
                    return@withContext file
                }

                // ✅ Download
                val url = URL(videoUrl)
                val connection = url.openConnection()
                connection.connect()

                connection.getInputStream().use { input ->
                    FileOutputStream(file).use { output ->
                        input.copyTo(output)
                    }
                }

                file

            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }
    }

    fun getLocalVideoFile(context: Context): File {
        return File(context.filesDir, FILE_NAME)
    }

}
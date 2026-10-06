package com.nice.aivastracatalogue

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Saves a downloaded image/video into the shared gallery
        // (Pictures/ or Movies/ under an "AI Vastra" folder) via MediaStore,
        // which needs no storage permission on Android 10+.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "aivastra/media_saver")
            .setMethodCallHandler { call, result ->
                if (call.method != "saveToGallery") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val path = call.argument<String>("path")
                val name = call.argument<String>("name")
                val mime = call.argument<String>("mimeType")
                val isVideo = call.argument<Boolean>("isVideo") ?: false
                if (path == null || name == null || mime == null) {
                    result.error("bad_args", "path, name and mimeType are required", null)
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    // Pre-10 needs a runtime storage permission; let Dart fall back.
                    result.error("unsupported", "Gallery save needs Android 10+", null)
                    return@setMethodCallHandler
                }
                try {
                    val collection = if (isVideo) {
                        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    } else {
                        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    }
                    val dir = if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, "$dir/AI Vastra")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val resolver = contentResolver
                    val uri = resolver.insert(collection, values)
                        ?: throw IllegalStateException("MediaStore insert failed")
                    resolver.openOutputStream(uri)?.use { out ->
                        File(path).inputStream().use { it.copyTo(out) }
                    } ?: throw IllegalStateException("Could not open output stream")
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    result.success(uri.toString())
                } catch (e: Exception) {
                    result.error("save_failed", e.message, null)
                }
            }
    }
}

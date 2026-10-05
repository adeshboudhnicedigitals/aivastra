import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

const _channel = MethodChannel('aivastra/media_saver');

/// Downloads the file at [url] (a presigned GET) and saves it into the
/// device gallery — Pictures/AI Vastra for images, Movies/AI Vastra for
/// videos. Throws if the download or the save fails.
///
/// [baseName] has no extension: results are JPEG, PNG or WebP depending on
/// the pipeline that made them, so an image's real type is read from its
/// header rather than assumed.
///
/// A plain [Dio] on purpose: the presigned URL carries its own auth, and the
/// app's API client would add a Bearer header that storage rejects.
Future<void> saveRemoteMediaToGallery({
  required String url,
  required String baseName,
  required bool isVideo,
}) async {
  final dir = await getTemporaryDirectory();
  final tempPath = '${dir.path}/$baseName.download';
  await Dio().download(url, tempPath);
  try {
    final (ext, mime) = isVideo
        ? ('mp4', 'video/mp4')
        : await _sniffImage(tempPath);
    await _channel.invokeMethod<String>('saveToGallery', {
      'path': tempPath,
      'name': '$baseName.$ext',
      'mimeType': mime,
      'isVideo': isVideo,
    });
  } finally {
    // The gallery holds its own copy; don't leave the temp one behind.
    final file = File(tempPath);
    if (await file.exists()) await file.delete();
  }
}

Future<(String, String)> _sniffImage(String path) async {
  final raf = await File(path).open();
  try {
    final head = await raf.read(12);
    if (head.length >= 4 &&
        head[0] == 0x89 &&
        head[1] == 0x50 &&
        head[2] == 0x4E &&
        head[3] == 0x47) {
      return ('png', 'image/png');
    }
    if (head.length >= 12 &&
        String.fromCharCodes(head.sublist(0, 4)) == 'RIFF' &&
        String.fromCharCodes(head.sublist(8, 12)) == 'WEBP') {
      return ('webp', 'image/webp');
    }
    return ('jpg', 'image/jpeg');
  } finally {
    await raf.close();
  }
}

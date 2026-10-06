import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Downloads the file at [url] (a presigned GET, e.g. `/v1/jobs/:id/result`)
/// into the cache directory and hands it to the OS share sheet as an actual
/// attachment — not the link itself, since these URLs are 1-hour presigned
/// and would be dead by the time a recipient opens them.
Future<void> shareRemoteMedia({
  required String url,
  required String filename,
  String? text,
}) async {
  final dir = await getTemporaryDirectory();
  final path = '${dir.path}/$filename';
  await Dio().download(url, path);
  await SharePlus.instance.share(ShareParams(files: [XFile(path)], text: text));
}

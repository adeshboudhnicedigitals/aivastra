import 'dart:io';

import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/upload_presign.dart';

/// `POST /v1/uploads/presign` + the direct-to-storage `PUT`.
///
/// The presign call goes through the authenticated app [Dio] instance; the
/// actual file PUT goes straight to the presigned URL (a different host)
/// using a bare [Dio] with no interceptors — attaching our API bearer token
/// or retry logic to that request would be meaningless at best and rejected
/// by the storage provider at worst.
class UploadApi {
  UploadApi(this._dio);

  final Dio _dio;

  Future<UploadPresign> presign({
    required String contentType,
    required int contentLength,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.uploadsPresign,
        data: {'contentType': contentType, 'contentLength': contentLength},
      );
      return UploadPresign.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// Presigns and uploads [file], returning the resulting `r2Key` to pass as
  /// `upperGarmentKey`/`lowerGarmentKey`/`thirdGarmentKey`/`sourceImageKey`.
  Future<String> presignAndUpload(File file) async {
    final bytes = await file.readAsBytes();
    final contentType = _contentTypeOf(file.path);
    final presigned = await presign(
      contentType: contentType,
      contentLength: bytes.length,
    );
    try {
      await Dio().put(
        presigned.uploadUrl,
        data: bytes,
        options: Options(
          headers: {'Content-Type': contentType},
          contentType: contentType,
        ),
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
    return presigned.r2Key;
  }

  String _contentTypeOf(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }
}

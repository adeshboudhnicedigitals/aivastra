import 'dart:io';

import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/custom_background.dart';

/// `/v1/backgrounds/mine` — a user's own uploaded/imported backgrounds.
///
/// The upload flow mirrors [UploadApi] (presign, then a raw PUT to storage
/// with a bare, interceptor-free [Dio]) but has an extra `confirm` step: the
/// server re-derives the real image format from bytes, validates it,
/// generates a thumbnail, and only then creates the `backgrounds` row.
class CustomBackgroundsApi {
  CustomBackgroundsApi(this._dio);

  final Dio _dio;

  Future<List<CustomBackground>> list() async {
    try {
      final response = await _dio.get(ApiPaths.backgroundsMine);
      final items =
          (response.data as Map<String, dynamic>)['items'] as List<dynamic>;
      return items
          .map((e) => CustomBackground.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<BackgroundUploadPresign> _presign({
    required String contentType,
    required int contentLength,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.backgroundsMinePresign,
        data: {'contentType': contentType, 'contentLength': contentLength},
      );
      return BackgroundUploadPresign.fromJson(
        response.data as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<CustomBackground> _confirm({
    required String r2Key,
    String? label,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.backgroundsMineConfirm,
        data: {'r2Key': r2Key, 'label': ?label},
      );
      return CustomBackground.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// Presigns, uploads the raw bytes, then confirms — returning the new
  /// background (its `id` is usable as `backgroundId` immediately).
  Future<CustomBackground> uploadFile(File file, {String? label}) async {
    final bytes = await file.readAsBytes();
    final contentType = _contentTypeOf(file.path);
    final presigned = await _presign(
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
    return _confirm(r2Key: presigned.r2Key, label: label);
  }

  Future<CustomBackground> fromUrl({required String url, String? label}) async {
    try {
      final response = await _dio.post(
        ApiPaths.backgroundsMineFromUrl,
        data: {'url': url, 'label': ?label},
      );
      return CustomBackground.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> delete(String id) async {
    try {
      await _dio.delete(ApiPaths.backgroundMine(id));
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  String _contentTypeOf(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }
}

import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/catalog_node.dart';
import '../models/catalog_options.dart';

/// `GET /v1/catalog/:type` — the lower-garment / shoe picker tree.
class CatalogApi {
  CatalogApi(this._dio);

  final Dio _dio;

  Future<CatalogTree> tree({
    required String type,
    String? gender,
    String? garmentTypeId,
    List<String>? poseIds,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.catalog(type),
        queryParameters: {
          'gender': ?gender,
          'garmentTypeId': ?garmentTypeId,
          if (poseIds != null && poseIds.isNotEmpty)
            'poseIds': poseIds.join(','),
        },
      );
      return CatalogTree.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// `GET /v1/dev/catalog/options` — returns all selectable catalog assets
  /// (garment types, faces, backgrounds, poses, lower items, shoe items) in
  /// a single call, keyed by [slug].
  Future<CatalogOptions> catalogOptions({
    required String gender,
    String? garmentType,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.catalogOptions,
        queryParameters: {'gender': gender, 'garmentType': ?garmentType},
      );
      return CatalogOptions.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

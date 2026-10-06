import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/background_category.dart';
import '../models/background_model.dart';
import '../models/catalogue_template.dart';
import '../models/face_model.dart';
import '../models/garment_type.dart';
import '../models/pose_model.dart';

/// Read-only reference-data endpoints under `/v1/models/*`.
class StudioReferenceApi {
  StudioReferenceApi(this._dio);

  final Dio _dio;

  Future<List<GarmentType>> garmentTypes(String gender) async {
    try {
      final response = await _dio.get(
        ApiPaths.garmentTypes,
        queryParameters: {'gender': gender},
      );
      return _items(response.data, GarmentType.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<FaceModel>> faces(String gender) async {
    try {
      final response = await _dio.get(
        ApiPaths.faces,
        queryParameters: {'gender': gender},
      );
      return _items(response.data, FaceModel.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<BackgroundModel>> backgrounds({String? gender}) async {
    try {
      final response = await _dio.get(
        ApiPaths.backgrounds,
        queryParameters: {'gender': ?gender},
      );
      return _items(response.data, BackgroundModel.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<BackgroundCategory>> backgroundCategories({
    String? gender,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.backgroundCategories,
        queryParameters: {'gender': ?gender},
      );
      return _items(response.data, BackgroundCategory.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<PoseModel>> poses({
    required String gender,
    String? garmentTypeId,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.poses,
        queryParameters: {'gender': gender, 'garmentTypeId': ?garmentTypeId},
      );
      return _items(response.data, PoseModel.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<CatalogueTemplate>> catalogueTemplates({
    required String gender,
    required String garmentTypeId,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.catalogueTemplates,
        queryParameters: {'gender': gender, 'garmentTypeId': garmentTypeId},
      );
      return _items(response.data, CatalogueTemplate.fromJson);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  List<T> _items<T>(dynamic data, T Function(Map<String, dynamic>) fromJson) {
    final items = (data as Map<String, dynamic>)['items'] as List<dynamic>;
    return items.map((e) => fromJson(e as Map<String, dynamic>)).toList();
  }
}

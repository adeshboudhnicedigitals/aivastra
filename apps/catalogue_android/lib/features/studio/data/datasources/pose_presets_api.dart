import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/pose_preset.dart';

class PosePresetsApi {
  PosePresetsApi(this._dio);

  final Dio _dio;

  Future<PosePresetsResponse> list({
    required String gender,
    required String garmentTypeId,
  }) async {
    try {
      final response = await _dio.get(
        ApiPaths.posePresets,
        queryParameters: {'gender': gender, 'garmentTypeId': garmentTypeId},
      );
      return PosePresetsResponse.fromJson(
        response.data as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<PosePreset> create({
    required String name,
    required String gender,
    required String garmentTypeId,
    required List<String> poseIds,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.posePresets,
        data: {
          'name': name,
          'gender': gender,
          'garmentTypeId': garmentTypeId,
          'poseIds': poseIds,
        },
      );
      return PosePreset.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> delete(String id) async {
    try {
      await _dio.delete(ApiPaths.posePreset(id));
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

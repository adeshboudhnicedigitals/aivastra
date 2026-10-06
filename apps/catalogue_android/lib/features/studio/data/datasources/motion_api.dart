import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/sample_video.dart';

class MotionApi {
  MotionApi(this._dio);

  final Dio _dio;

  Future<SampleVideosResponse> sampleVideos() async {
    try {
      final response = await _dio.get(ApiPaths.sampleVideos);
      return SampleVideosResponse.fromJson(
        response.data as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// Returns the created job's id. [sourceJobId] and [sourceImageKey] are
  /// mutually exclusive (enforced by the caller).
  Future<String> submitCatalogVideo({
    String? sourceJobId,
    String? sourceImageKey,
    String? sampleVideoId,
    int? duration,
    required String quality,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.catalogueVideoJob,
        data: {
          'sourceJobId': ?sourceJobId,
          'sourceImageKey': ?sourceImageKey,
          'sampleVideoId': ?sampleVideoId,
          'duration': ?duration,
          'quality': quality,
        },
      );
      return (response.data as Map<String, dynamic>)['jobId'] as String;
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/resolutions_config.dart';

class ConfigApi {
  ConfigApi(this._dio);

  final Dio _dio;

  Future<ResolutionsConfig> resolutions() async {
    try {
      final response = await _dio.get(ApiPaths.configResolutions);
      return ResolutionsConfig.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/credits_summary.dart';

class CreditsApi {
  CreditsApi(this._dio);

  final Dio _dio;

  Future<CreditsSummary> credits() async {
    try {
      final response = await _dio.get(ApiPaths.credits);
      return CreditsSummary.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

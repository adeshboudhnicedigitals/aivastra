import 'package:dio/dio.dart';

import 'active_device_info.dart';
import 'app_exception.dart';

/// Translates a [DioException] into a typed [AppException], reading the
/// backend's `{ "error": { "code", "message", ... } }` envelope where present.
class DioExceptionMapper {
  DioExceptionMapper._();

  static AppException map(DioException error) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.connectionError) {
      return const AppException.network(
        'Could not reach the server. Check your connection and try again.',
      );
    }

    final response = error.response;
    if (response == null) {
      return AppException.unknown(error.message ?? 'Something went wrong.');
    }

    final status = response.statusCode ?? 0;
    final body = response.data;
    final errorObj = body is Map<String, dynamic> ? body['error'] : null;
    final code = errorObj is Map<String, dynamic>
        ? errorObj['code'] as String?
        : null;
    final message = errorObj is Map<String, dynamic>
        ? (errorObj['message'] as String? ?? _fallbackMessage(status))
        : _fallbackMessage(status);

    if (status == 409 && code == 'DEVICE_LIMIT_REACHED') {
      final devicesJson = (errorObj!['activeDevices'] as List<dynamic>? ?? []);
      return AppException.deviceLimitReached(
        message: message,
        forceLogoutToken: errorObj['forceLogoutToken'] as String? ?? '',
        maxActiveDevices: errorObj['maxActiveDevices'] as int? ?? 1,
        activeDevices: devicesJson
            .map((d) => ActiveDeviceInfo.fromJson(d as Map<String, dynamic>))
            .toList(),
      );
    }

    if (code == 'INVALID_REFRESH') {
      return AppException.invalidRefresh(message);
    }

    if (status == 403) {
      return code == 'EMAIL_NOT_VERIFIED'
          ? AppException.emailNotVerified(message)
          : AppException.forbidden(message);
    }

    if (status == 429) {
      return AppException.rateLimited(message);
    }

    if (status == 401) {
      return AppException.unauthorized(message);
    }

    if (status == 400 || status == 422) {
      return AppException.badRequest(message);
    }

    if (status >= 500) {
      return AppException.server(message);
    }

    return AppException.unknown(message);
  }

  static String _fallbackMessage(int status) {
    if (status >= 500) return 'Server error. Please try again shortly.';
    if (status == 401) return 'Invalid credentials.';
    if (status == 429) return 'Too many attempts. Please try again later.';
    return 'Something went wrong.';
  }
}

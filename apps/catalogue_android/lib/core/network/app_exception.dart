import 'package:freezed_annotation/freezed_annotation.dart';

import 'active_device_info.dart';

part 'app_exception.freezed.dart';

/// Typed application-level error, produced from a [DioExceptionMapper] so
/// that view models never need to inspect raw Dio/HTTP details.
@freezed
sealed class AppException with _$AppException implements Exception {
  const factory AppException.badRequest(String message) = BadRequestException;

  const factory AppException.unauthorized(String message) =
      UnauthorizedException;

  const factory AppException.emailNotVerified(String message) =
      EmailNotVerifiedException;

  const factory AppException.forbidden(String message) = ForbiddenException;

  const factory AppException.deviceLimitReached({
    required String message,
    required String forceLogoutToken,
    required int maxActiveDevices,
    required List<ActiveDeviceInfo> activeDevices,
  }) = DeviceLimitReachedException;

  const factory AppException.invalidRefresh(String message) =
      InvalidRefreshException;

  const factory AppException.rateLimited(String message) = RateLimitedException;

  const factory AppException.network(String message) = NetworkException;

  const factory AppException.server(String message) = ServerException;

  const factory AppException.unknown(String message) = UnknownException;
}

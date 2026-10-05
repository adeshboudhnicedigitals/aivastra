import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/auth_session.dart';
import '../models/me_profile.dart';

/// Raw Dio calls, one per endpoint. Every method throws a typed
/// `AppException` (via [DioExceptionMapper]) instead of a raw [DioException].
class AuthApi {
  AuthApi(this._dio);

  final Dio _dio;

  Future<bool> register({
    required String email,
    required String password,
    required String displayName,
    String? signupSource,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.register,
        data: {
          'email': email,
          'password': password,
          'displayName': displayName,
          'signupSource': ?signupSource,
        },
      );
      return response.data['requiresEmailVerification'] as bool? ?? true;
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> verifyEmail(String token) async {
    try {
      await _dio.get(ApiPaths.verifyEmail, queryParameters: {'token': token});
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> resendVerification(String email) async {
    try {
      await _dio.post(ApiPaths.resendVerification, data: {'email': email});
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<AuthSession> deviceLogin({
    required String email,
    required String password,
    required String deviceId,
    String? deviceName,
    required String platform,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.deviceLogin,
        data: {
          'email': email,
          'password': password,
          'deviceId': deviceId,
          'deviceName': ?deviceName,
          'platform': platform,
        },
      );
      return AuthSession.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<AuthSession> deviceLoginForce({
    required String forceLogoutToken,
    required String deviceId,
    String? deviceName,
    required String platform,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.deviceLoginForce,
        data: {
          'forceLogoutToken': forceLogoutToken,
          'deviceId': deviceId,
          'deviceName': ?deviceName,
          'platform': platform,
        },
      );
      return AuthSession.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<AuthSession> deviceLoginGoogle({
    required String idToken,
    required String deviceId,
    String? deviceName,
    required String platform,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.deviceLoginGoogle,
        data: {
          'idToken': idToken,
          'deviceId': deviceId,
          'deviceName': ?deviceName,
          'platform': platform,
        },
      );
      return AuthSession.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// Returns `(accessToken, refreshToken)` — refreshToken is null when the
  /// server issued a plain reissue (keep the existing one in that case).
  Future<(String, String?)> deviceRefresh({
    required String refreshToken,
    required String platform,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.deviceRefresh,
        data: {'refreshToken': refreshToken, 'platform': platform},
      );
      final data = response.data as Map<String, dynamic>;
      return (data['accessToken'] as String, data['refreshToken'] as String?);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> deviceLogout(String refreshToken) async {
    try {
      await _dio.post(
        ApiPaths.deviceLogout,
        data: {'refreshToken': refreshToken},
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> forgotPassword(String email) async {
    try {
      await _dio.post(ApiPaths.forgotPassword, data: {'email': email});
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> resetPassword({
    required String token,
    required String newPassword,
  }) async {
    try {
      await _dio.post(
        ApiPaths.resetPassword,
        data: {'token': token, 'newPassword': newPassword},
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// `PATCH /v1/me` - only the keys present in [body] are changed.
  Future<void> updateMe(Map<String, dynamic> body) async {
    try {
      await _dio.patch(ApiPaths.me, data: body);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// `PATCH /v1/me/password`. [currentPassword] is required by the server
  /// when the account already has a password, and must be omitted when
  /// setting a first one (Google / email-link accounts).
  Future<void> changePassword({
    String? currentPassword,
    required String newPassword,
  }) async {
    try {
      await _dio.patch(
        ApiPaths.mePassword,
        data: {'currentPassword': ?currentPassword, 'newPassword': newPassword},
      );
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<MeProfile> me() async {
    try {
      final response = await _dio.get(ApiPaths.me);
      return MeProfile.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

import 'dart:convert';

import '../../../../core/network/app_exception.dart';
import '../../../../core/storage/auth_token_cache.dart';
import '../../../../core/storage/profile_cache.dart';
import '../../../../core/utils/device_info_helper.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_api.dart';
import '../models/auth_session.dart';
import '../models/me_profile.dart';

const _platform = 'mobile';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({
    required this.api,
    required this.tokenCache,
    required this.deviceInfoHelper,
    required this.profileCache,
  });

  final AuthApi api;
  final AuthTokenCache tokenCache;
  final DeviceInfoHelper deviceInfoHelper;
  final ProfileCache profileCache;

  @override
  Future<bool> register({
    required String email,
    required String password,
    required String displayName,
    String? signupSource,
  }) {
    return api.register(
      email: email,
      password: password,
      displayName: displayName,
      signupSource: signupSource,
    );
  }

  @override
  Future<void> resendVerification(String email) =>
      api.resendVerification(email);

  @override
  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final deviceId = await deviceInfoHelper.resolveDeviceId();
    final deviceName = await deviceInfoHelper.resolveDeviceName();
    final session = await api.deviceLogin(
      email: email,
      password: password,
      deviceId: deviceId,
      deviceName: deviceName,
      platform: _platform,
    );
    await _persistSession(session);
    return session;
  }

  @override
  Future<AuthSession> forceLogin(String forceLogoutToken) async {
    final deviceId = await deviceInfoHelper.resolveDeviceId();
    final deviceName = await deviceInfoHelper.resolveDeviceName();
    final session = await api.deviceLoginForce(
      forceLogoutToken: forceLogoutToken,
      deviceId: deviceId,
      deviceName: deviceName,
      platform: _platform,
    );
    await _persistSession(session);
    return session;
  }

  @override
  Future<AuthSession> loginWithGoogle(String idToken) async {
    final deviceId = await deviceInfoHelper.resolveDeviceId();
    final deviceName = await deviceInfoHelper.resolveDeviceName();
    final session = await api.deviceLoginGoogle(
      idToken: idToken,
      deviceId: deviceId,
      deviceName: deviceName,
      platform: _platform,
    );
    await _persistSession(session);
    return session;
  }

  @override
  Future<void> refreshSession() async {
    final refreshToken = tokenCache.refreshToken;
    if (refreshToken == null) {
      throw const AppException.invalidRefresh('No active session.');
    }
    final (accessToken, newRefreshToken) = await api.deviceRefresh(
      refreshToken: refreshToken,
      platform: _platform,
    );
    if (newRefreshToken != null) {
      await tokenCache.setSession(
        accessToken: accessToken,
        refreshToken: newRefreshToken,
      );
    } else {
      await tokenCache.updateAccessToken(accessToken);
    }
  }

  @override
  Future<void> logout() async {
    final refreshToken = tokenCache.refreshToken;
    try {
      if (refreshToken != null) {
        await api.deviceLogout(refreshToken);
      }
    } finally {
      await tokenCache.clear();
      await profileCache.clear();
    }
  }

  @override
  Future<void> forgotPassword(String email) => api.forgotPassword(email);

  @override
  Future<void> resetPassword({
    required String token,
    required String newPassword,
  }) {
    return api.resetPassword(token: token, newPassword: newPassword);
  }

  @override
  Future<MeProfile> fetchMe() async {
    final profile = await api.me();
    await profileCache.saveMeJson(jsonEncode(profile.toJson()));
    return profile;
  }

  @override
  Future<MeProfile> updateProfile(Map<String, dynamic> body) async {
    await api.updateMe(body);
    // Re-read rather than trust the PATCH echo: /v1/me is the full profile
    // (hasPassword etc.) and this also refreshes the on-device cache.
    return fetchMe();
  }

  @override
  Future<void> changePassword({
    String? currentPassword,
    required String newPassword,
  }) => api.changePassword(
    currentPassword: currentPassword,
    newPassword: newPassword,
  );

  @override
  MeProfile? readCachedMe() {
    final json = profileCache.readMeJson();
    if (json == null) return null;
    try {
      return MeProfile.fromJson(jsonDecode(json) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<void> _persistSession(AuthSession session) {
    return tokenCache.setSession(
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );
  }
}

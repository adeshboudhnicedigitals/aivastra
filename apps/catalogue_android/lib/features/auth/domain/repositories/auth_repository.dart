import '../../data/models/auth_session.dart';
import '../../data/models/me_profile.dart';

abstract class AuthRepository {
  Future<bool> register({
    required String email,
    required String password,
    required String displayName,
    String? signupSource,
  });

  Future<void> resendVerification(String email);

  Future<AuthSession> login({required String email, required String password});

  Future<AuthSession> forceLogin(String forceLogoutToken);

  Future<AuthSession> loginWithGoogle(String idToken);

  /// Refreshes the session in place (updates the token cache/storage).
  /// Throws if the refresh token is invalid/expired.
  Future<void> refreshSession();

  Future<void> logout();

  Future<void> forgotPassword(String email);

  Future<void> resetPassword({
    required String token,
    required String newPassword,
  });

  Future<MeProfile> fetchMe();

  /// Saves profile fields (`PATCH /v1/me`) and returns the refreshed profile.
  Future<MeProfile> updateProfile(Map<String, dynamic> body);

  Future<void> changePassword({
    String? currentPassword,
    required String newPassword,
  });

  /// Cached copy of the last `/v1/me` response, if any, read synchronously.
  MeProfile? readCachedMe();
}

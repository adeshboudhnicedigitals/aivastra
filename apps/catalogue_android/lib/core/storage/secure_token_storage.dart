import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the access/refresh tokens in OS-encrypted storage
/// (Android Keystore / iOS Keychain). This is the only place tokens touch
/// disk — everything else reads from [AuthTokenCache].
class SecureTokenStorage {
  SecureTokenStorage(this._storage);

  final FlutterSecureStorage _storage;

  static const _accessTokenKey = 'auth_access_token';
  static const _refreshTokenKey = 'auth_refresh_token';

  Future<(String?, String?)> readTokens() async {
    final values = await _storage.readAll();
    return (values[_accessTokenKey], values[_refreshTokenKey]);
  }

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<void> saveAccessToken(String accessToken) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
  }

  Future<void> clear() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
  }
}

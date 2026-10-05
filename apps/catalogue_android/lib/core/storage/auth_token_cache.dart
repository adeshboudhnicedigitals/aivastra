import 'package:flutter/foundation.dart';

import 'secure_token_storage.dart';

/// Fast, synchronous in-memory view of the current tokens, backed by
/// [SecureTokenStorage]. The [AuthInterceptor] reads this on every request
/// instead of awaiting secure storage each time; [hasSession] is a
/// [ValueListenable] the router/auth controller can react to.
class AuthTokenCache {
  AuthTokenCache(this._storage);

  final SecureTokenStorage _storage;

  String? _accessToken;
  String? _refreshToken;

  final ValueNotifier<bool> hasSession = ValueNotifier(false);

  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;

  Future<void> loadFromStorage() async {
    final (access, refresh) = await _storage.readTokens();
    _accessToken = access;
    _refreshToken = refresh;
    hasSession.value = access != null && refresh != null;
  }

  Future<void> setSession({
    required String accessToken,
    required String refreshToken,
  }) async {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    hasSession.value = true;
    await _storage.saveTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
    );
  }

  Future<void> updateAccessToken(String accessToken) async {
    _accessToken = accessToken;
    await _storage.saveAccessToken(accessToken);
  }

  Future<void> clear() async {
    _accessToken = null;
    _refreshToken = null;
    hasSession.value = false;
    await _storage.clear();
  }
}

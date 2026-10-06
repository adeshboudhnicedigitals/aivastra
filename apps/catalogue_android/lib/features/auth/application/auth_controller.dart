import 'dart:async';

import 'package:flutter/painting.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/app_user.dart';
import '../data/models/auth_session.dart';
import '../domain/repositories/auth_repository.dart';
import 'auth_providers.dart';
import 'auth_state.dart';

/// App-wide session state. The router reads this to decide where to send
/// the user; screens read `currentUserProvider`/`currentProfileProvider` to
/// populate real data instead of placeholders.
class AuthController extends Notifier<AuthState> {
  late final AuthRepository _repository;

  @override
  AuthState build() {
    _repository = ref.watch(authRepositoryProvider);
    return AuthState.initial();
  }

  /// Called once from `main()` before `runApp`, and awaited so the router's
  /// first redirect decision already knows whether a session exists.
  Future<void> bootstrap(bool hasStoredSession) async {
    if (!hasStoredSession) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }
    final cached = _repository.readCachedMe();
    if (cached != null) {
      state = AuthState(status: AuthStatus.authenticated, profile: cached);
    }
    try {
      final me = await _repository.fetchMe();
      state = AuthState(status: AuthStatus.authenticated, profile: me);
    } on InvalidRefreshException catch (_) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    } catch (_) {
      // Rate limit / network / server hiccup — the stored tokens are still
      // valid, so trust hasStoredSession rather than kicking the user back
      // to login; the profile stays whatever `cached` already set it to
      // (null is fine, screens will pick it up once a later fetch succeeds).
      if (cached == null) {
        state = const AuthState(status: AuthStatus.authenticated);
      }
    }
  }

  void setSession(AuthSession session) {
    state = AuthState(status: AuthStatus.authenticated, user: session.user);
    // Populate the richer /me profile in the background; failure here
    // shouldn't block the user from reaching the app.
    _repository
        .fetchMe()
        .then((profile) {
          state = state.copyWith(profile: profile);
        })
        .catchError((_) {});
  }

  void setUser(AppUser user) {
    state = AuthState(status: AuthStatus.authenticated, user: user);
  }

  /// Saves the profile and publishes the refreshed copy so every screen that
  /// shows the user's name / defaults updates at once.
  Future<void> updateProfile(Map<String, dynamic> body) async {
    final profile = await _repository.updateProfile(body);
    state = state.copyWith(profile: profile);
  }

  /// The server revokes every refresh token when a password changes, so the
  /// session can no longer be renewed. Sign out right away with a clear
  /// message instead of letting it lapse at some random later moment.
  Future<void> changePassword({
    String? currentPassword,
    required String newPassword,
  }) async {
    await _repository.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    await logout();
  }

  Future<void> logout() async {
    await _repository.logout();
    _clearImageCaches();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Invoked by [AuthInterceptor] when a refresh attempt fails.
  Future<void> forceLogout() async {
    _clearImageCaches();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Photos are cached on disk (`app_network_image.dart`) and they are the
  /// account's own garments and results, so they go when the session does —
  /// not left on the device for whoever signs in next. Best effort: a failure
  /// to clear must never block signing out.
  void _clearImageCaches() {
    PaintingBinding.instance.imageCache.clear();
    unawaited(DefaultCacheManager().emptyCache().catchError((Object _) {}));
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

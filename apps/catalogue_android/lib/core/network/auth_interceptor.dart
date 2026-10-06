import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/api_paths.dart';
import '../../features/auth/application/auth_controller.dart';
import '../../features/auth/application/auth_providers.dart';
import '../storage/auth_token_cache.dart';
import 'app_exception.dart';

/// Outcome of a refresh attempt — [invalid] means the refresh token itself
/// was rejected (session is truly over); [transientFailure] means the call
/// didn't go through for a reason that says nothing about the token's
/// validity (rate limit, network blip, 5xx), so the session must be kept
/// intact for the next attempt rather than forcing the user back to login.
enum _RefreshOutcome { success, invalid, transientFailure }

/// Attaches the bearer token to every request and, on a 401 from an
/// authenticated endpoint, single-flights a `device-refresh` call and
/// retries the original request once — matching the spec's recommended
/// "refresh, retry once, else send back to login" flow.
class AuthInterceptor extends Interceptor {
  AuthInterceptor(this._ref, this._tokenCache, this._dio);

  // This is dioProvider's own Ref (it builds this interceptor). Reading
  // authRepositoryProvider through it directly — `_ref.read(...)` — closes a
  // cycle: authRepositoryProvider -> authApiProvider -> dioProvider -> (this
  // read) -> authRepositoryProvider, which Riverpod rejects at runtime with a
  // CircularDependencyError (silently swallowed below as "refresh failed",
  // permanently breaking session refresh). `_ref.container` is Riverpod's
  // documented escape hatch for exactly this — reading a provider from a
  // callback that isn't part of the reactive graph — and doesn't attribute
  // the read to dioProvider's element, so it can't close the loop.
  final Ref _ref;
  final AuthTokenCache _tokenCache;
  final Dio _dio;

  Completer<_RefreshOutcome>? _refreshCompleter;

  static const _noAuthPaths = [
    ApiPaths.register,
    ApiPaths.verifyEmail,
    ApiPaths.resendVerification,
    ApiPaths.deviceLogin,
    ApiPaths.deviceLoginForce,
    ApiPaths.deviceLoginGoogle,
    ApiPaths.deviceRefresh,
    ApiPaths.deviceLogout,
    ApiPaths.forgotPassword,
    ApiPaths.resetPassword,
  ];

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = _tokenCache.accessToken;
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final path = err.requestOptions.path;
    final alreadyRetried = err.requestOptions.extra['retried'] == true;

    final isRecoverable =
        err.response?.statusCode == 401 &&
        !_noAuthPaths.contains(path) &&
        !alreadyRetried;

    if (kDebugMode) {
      debugPrint(
        '[AuthInterceptor] 401 on $path — recoverable=$isRecoverable '
        '(status=${err.response?.statusCode}, excluded=${_noAuthPaths.contains(path)}, '
        'alreadyRetried=$alreadyRetried, hasRefreshToken=${_tokenCache.refreshToken != null})',
      );
    }

    if (!isRecoverable) {
      return handler.next(err);
    }

    final outcome = await _refreshOnce();
    if (kDebugMode) {
      debugPrint('[AuthInterceptor] refresh attempt result: $outcome');
    }
    if (outcome == _RefreshOutcome.invalid) {
      await _ref.container.read(authControllerProvider.notifier).forceLogout();
      return handler.next(err);
    }
    if (outcome == _RefreshOutcome.transientFailure) {
      // Rate limit / network / server hiccup — the refresh token is still
      // good, so just fail this one request rather than tearing the session
      // down; the next request gets its own refresh attempt.
      return handler.next(err);
    }

    try {
      final retryOptions = err.requestOptions;
      retryOptions.extra['retried'] = true;
      retryOptions.headers['Authorization'] =
          'Bearer ${_tokenCache.accessToken}';
      final response = await _dio.fetch(retryOptions);
      return handler.resolve(response);
    } on DioException catch (retryError) {
      return handler.next(retryError);
    }
  }

  Future<_RefreshOutcome> _refreshOnce() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    final completer = Completer<_RefreshOutcome>();
    _refreshCompleter = completer;
    try {
      await _ref.container.read(authRepositoryProvider).refreshSession();
      completer.complete(_RefreshOutcome.success);
    } on InvalidRefreshException catch (e) {
      if (kDebugMode) {
        debugPrint('[AuthInterceptor] refreshSession() threw: $e');
      }
      completer.complete(_RefreshOutcome.invalid);
    } catch (e) {
      if (kDebugMode) {
        debugPrint('[AuthInterceptor] refreshSession() threw: $e');
      }
      completer.complete(_RefreshOutcome.transientFailure);
    } finally {
      _refreshCompleter = null;
    }
    return completer.future;
  }
}

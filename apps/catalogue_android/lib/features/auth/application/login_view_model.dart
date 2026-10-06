import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/auth_session.dart';
import 'auth_controller.dart';
import 'auth_providers.dart';

part 'login_view_model.freezed.dart';

@freezed
abstract class LoginState with _$LoginState {
  const factory LoginState({
    @Default(false) bool isSubmitting,
    String? errorMessage,
    DeviceLimitReachedException? deviceLimit,
  }) = _LoginState;
}

class LoginViewModel extends Notifier<LoginState> {
  @override
  LoginState build() => const LoginState();

  Future<bool> submit({required String email, required String password}) async {
    state = state.copyWith(
      isSubmitting: true,
      errorMessage: null,
      deviceLimit: null,
    );
    try {
      final AuthSession session = await ref
          .read(authRepositoryProvider)
          .login(email: email, password: password);
      ref.read(authControllerProvider.notifier).setSession(session);
      state = state.copyWith(isSubmitting: false);
      return true;
    } on AppException catch (e) {
      state = e.when(
        badRequest: (m) => state.copyWith(isSubmitting: false, errorMessage: m),
        unauthorized: (m) =>
            state.copyWith(isSubmitting: false, errorMessage: m),
        emailNotVerified: (m) =>
            state.copyWith(isSubmitting: false, errorMessage: m),
        forbidden: (m) => state.copyWith(isSubmitting: false, errorMessage: m),
        deviceLimitReached: (_, _, _, _) => state.copyWith(
          isSubmitting: false,
          deviceLimit: e as DeviceLimitReachedException,
        ),
        invalidRefresh: (m) =>
            state.copyWith(isSubmitting: false, errorMessage: m),
        rateLimited: (m) =>
            state.copyWith(isSubmitting: false, errorMessage: m),
        network: (m) => state.copyWith(isSubmitting: false, errorMessage: m),
        server: (m) => state.copyWith(isSubmitting: false, errorMessage: m),
        unknown: (m) => state.copyWith(isSubmitting: false, errorMessage: m),
      );
      return false;
    }
  }

  Future<bool> forceLogin() async {
    final token = state.deviceLimit?.forceLogoutToken;
    if (token == null) return false;
    state = state.copyWith(isSubmitting: true, errorMessage: null);
    try {
      final session = await ref.read(authRepositoryProvider).forceLogin(token);
      ref.read(authControllerProvider.notifier).setSession(session);
      state = state.copyWith(isSubmitting: false, deviceLimit: null);
      return true;
    } on AppException catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: _messageOf(e),
        deviceLimit: null,
      );
      return false;
    }
  }

  Future<bool> loginWithGoogle(String idToken) async {
    state = state.copyWith(isSubmitting: true, errorMessage: null);
    try {
      final session = await ref
          .read(authRepositoryProvider)
          .loginWithGoogle(idToken);
      ref.read(authControllerProvider.notifier).setSession(session);
      state = state.copyWith(isSubmitting: false);
      return true;
    } on AppException catch (e) {
      state = state.copyWith(isSubmitting: false, errorMessage: _messageOf(e));
      return false;
    }
  }

  void dismissDeviceLimit() => state = state.copyWith(deviceLimit: null);

  String _messageOf(AppException e) => e.when(
    badRequest: (m) => m,
    unauthorized: (m) => m,
    emailNotVerified: (m) => m,
    forbidden: (m) => m,
    deviceLimitReached: (m, _, _, _) => m,
    invalidRefresh: (m) => m,
    rateLimited: (m) => m,
    network: (m) => m,
    server: (m) => m,
    unknown: (m) => m,
  );
}

final loginViewModelProvider = NotifierProvider<LoginViewModel, LoginState>(
  LoginViewModel.new,
);

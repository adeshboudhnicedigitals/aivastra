import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import 'auth_providers.dart';

part 'reset_password_view_model.freezed.dart';

@freezed
abstract class ResetPasswordState with _$ResetPasswordState {
  const factory ResetPasswordState({
    @Default(false) bool isSubmitting,
    @Default(false) bool success,
    String? errorMessage,
  }) = _ResetPasswordState;
}

class ResetPasswordViewModel extends Notifier<ResetPasswordState> {
  @override
  ResetPasswordState build() => const ResetPasswordState();

  Future<void> submit({
    required String token,
    required String newPassword,
  }) async {
    state = state.copyWith(isSubmitting: true, errorMessage: null);
    try {
      await ref
          .read(authRepositoryProvider)
          .resetPassword(token: token, newPassword: newPassword);
      state = state.copyWith(isSubmitting: false, success: true);
    } on AppException catch (e) {
      state = state.copyWith(isSubmitting: false, errorMessage: _messageOf(e));
    }
  }

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

final resetPasswordViewModelProvider =
    NotifierProvider<ResetPasswordViewModel, ResetPasswordState>(
      ResetPasswordViewModel.new,
    );

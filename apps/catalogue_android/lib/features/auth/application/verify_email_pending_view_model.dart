import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import 'auth_providers.dart';

part 'verify_email_pending_view_model.freezed.dart';

@freezed
abstract class VerifyEmailPendingState with _$VerifyEmailPendingState {
  const factory VerifyEmailPendingState({
    @Default(false) bool isSending,
    @Default(false) bool justSent,
    String? errorMessage,
  }) = _VerifyEmailPendingState;
}

class VerifyEmailPendingViewModel extends Notifier<VerifyEmailPendingState> {
  @override
  VerifyEmailPendingState build() => const VerifyEmailPendingState();

  Future<void> resend(String email) async {
    state = state.copyWith(
      isSending: true,
      errorMessage: null,
      justSent: false,
    );
    try {
      await ref.read(authRepositoryProvider).resendVerification(email);
      state = state.copyWith(isSending: false, justSent: true);
    } on AppException catch (e) {
      state = state.copyWith(isSending: false, errorMessage: _messageOf(e));
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

final verifyEmailPendingViewModelProvider =
    NotifierProvider<VerifyEmailPendingViewModel, VerifyEmailPendingState>(
      VerifyEmailPendingViewModel.new,
    );

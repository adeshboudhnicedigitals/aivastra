import 'package:freezed_annotation/freezed_annotation.dart';

import 'app_user.dart';
import 'onboarding_prefill.dart';

part 'auth_session.freezed.dart';
part 'auth_session.g.dart';

/// Shape shared by `device-login`, `device-login/google` and
/// `device-login/force`.
@freezed
abstract class AuthSession with _$AuthSession {
  const factory AuthSession({
    required String accessToken,
    required String refreshToken,
    required AppUser user,
    String? logoUrl,
    String? loadingVideoUrl,
    required String merchantStatus,
    OnboardingPrefill? onboarding,
  }) = _AuthSession;

  factory AuthSession.fromJson(Map<String, dynamic> json) =>
      _$AuthSessionFromJson(json);
}

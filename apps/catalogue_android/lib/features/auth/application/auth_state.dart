import 'package:freezed_annotation/freezed_annotation.dart';

import '../data/models/app_user.dart';
import '../data/models/me_profile.dart';

part 'auth_state.freezed.dart';

enum AuthStatus { unknown, unauthenticated, authenticated }

@freezed
abstract class AuthState with _$AuthState {
  const factory AuthState({
    required AuthStatus status,
    AppUser? user,
    MeProfile? profile,
  }) = _AuthState;

  factory AuthState.initial() => const AuthState(status: AuthStatus.unknown);
}

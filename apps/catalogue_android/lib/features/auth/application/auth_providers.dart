import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import '../data/datasources/auth_api.dart';
import '../data/models/app_user.dart';
import '../data/models/me_profile.dart';
import '../data/repositories/auth_repository_impl.dart';
import '../domain/repositories/auth_repository.dart';
import 'auth_controller.dart';

final authApiProvider = Provider<AuthApi>(
  (ref) => AuthApi(ref.watch(dioProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepositoryImpl(
    api: ref.watch(authApiProvider),
    tokenCache: ref.watch(authTokenCacheProvider),
    deviceInfoHelper: ref.watch(deviceInfoHelperProvider),
    profileCache: ref.watch(profileCacheProvider),
  );
});

/// Convenience selectors for screens that only need the current user/profile.
final currentUserProvider = Provider<AppUser?>(
  (ref) => ref.watch(authControllerProvider).user,
);

final currentProfileProvider = Provider<MeProfile?>(
  (ref) => ref.watch(authControllerProvider).profile,
);

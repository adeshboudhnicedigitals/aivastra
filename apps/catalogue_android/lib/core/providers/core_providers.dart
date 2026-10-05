import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hive/hive.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../network/auth_interceptor.dart';
import '../network/dio_client.dart';
import '../storage/auth_token_cache.dart';
import '../storage/local_prefs.dart';
import '../storage/profile_cache.dart';
import '../storage/secure_token_storage.dart';
import '../utils/device_info_helper.dart';

/// Overridden in `main()` with the instance created before `runApp`.
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider not overridden'),
);

/// Overridden in `main()` with the box opened before `runApp`.
final profileBoxProvider = Provider<Box<String>>(
  (ref) => throw UnimplementedError('profileBoxProvider not overridden'),
);

final secureStorageProvider = Provider<FlutterSecureStorage>(
  (ref) => const FlutterSecureStorage(),
);

final secureTokenStorageProvider = Provider<SecureTokenStorage>(
  (ref) => SecureTokenStorage(ref.watch(secureStorageProvider)),
);

/// Single instance for the app's lifetime — created once via
/// `ProviderContainer` in `main()` and pre-loaded from storage before the
/// first frame so [dioProvider]'s interceptor has a token ready immediately.
final authTokenCacheProvider = Provider<AuthTokenCache>(
  (ref) => AuthTokenCache(ref.watch(secureTokenStorageProvider)),
);

final localPrefsProvider = Provider<LocalPrefs>(
  (ref) => LocalPrefs(ref.watch(sharedPreferencesProvider)),
);

final profileCacheProvider = Provider<ProfileCache>(
  (ref) => ProfileCache(ref.watch(profileBoxProvider)),
);

final deviceInfoHelperProvider = Provider<DeviceInfoHelper>(
  (ref) => DeviceInfoHelper(ref.watch(localPrefsProvider)),
);

final dioProvider = Provider<Dio>((ref) {
  final dio = buildDio();
  dio.interceptors.add(
    AuthInterceptor(ref, ref.watch(authTokenCacheProvider), dio),
  );
  return dio;
});

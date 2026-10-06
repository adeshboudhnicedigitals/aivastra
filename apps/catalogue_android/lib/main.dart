import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'config/app_config.dart';
import 'core/providers/core_providers.dart';
import 'core/storage/profile_cache.dart';
import 'features/auth/application/auth_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Hive.initFlutter();
  final profileBox = await Hive.openBox<String>(ProfileCache.boxName);
  final sharedPreferences = await SharedPreferences.getInstance();

  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(sharedPreferences),
      profileBoxProvider.overrideWithValue(profileBox),
    ],
  );

  final tokenCache = container.read(authTokenCacheProvider);
  await tokenCache.loadFromStorage();

  // Deliberately not awaited: `bootstrap` calls the API (fetchMe) to
  // validate/refresh the session, and awaiting a network round trip here
  // used to gate the very first Flutter frame — nothing paints until
  // `runApp` returns, so on a slow connection the user sat on Android's
  // plain default splash the whole time, never even seeing this app's own
  // branded one. `AuthController.build()` starts at `AuthStatus.unknown`,
  // and `app_router.dart`'s redirect already holds on SplashPage while
  // status is `unknown`, so letting this resolve in the background is safe
  // — the branded splash now shows immediately, with the router moving on
  // once both this and `splashHoldProvider`'s minimum reveal time are done.
  unawaited(
    container
        .read(authControllerProvider.notifier)
        .bootstrap(tokenCache.hasSession.value),
  );

  // Same reasoning: initialization isn't needed until the user actually taps
  // "Continue with Google" on the Login page, several screens away, so it
  // doesn't need to block startup either.
  unawaited(
    GoogleSignIn.instance
        .initialize(serverClientId: AppConfig.googleWebClientId)
        .catchError((Object e) {
          // Falls through to a runtime error only if the user actually taps
          // "Continue with Google" before a real client id is configured.
          debugPrint('GoogleSignIn.initialize failed: $e');
        }),
  );

  runApp(UncontrolledProviderScope(container: container, child: const App()));
}

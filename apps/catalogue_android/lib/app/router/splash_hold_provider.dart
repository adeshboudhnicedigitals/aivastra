import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Flips to `true` ~3.2s after the app starts: `SplashPage`'s own logo/
/// tagline fade-in starts at 1s and takes 500ms, so this leaves the fully
/// visible brand on screen for roughly 1.7s before moving on, rather than
/// just a flash. `AuthController.bootstrap` runs in the background rather
/// than being awaited before `runApp` (see `main.dart` — awaiting it there
/// used to block the first frame on a network round trip), so without this
/// gate `app_router.dart`'s redirect could otherwise jump past Splash the
/// moment auth resolves, before this reveal animation ever gets to play.
class SplashHoldNotifier extends Notifier<bool> {
  @override
  bool build() {
    Timer(const Duration(milliseconds: 3200), () {
      if (ref.mounted) state = true;
    });
    return false;
  }
}

final splashHoldProvider = NotifierProvider<SplashHoldNotifier, bool>(
  SplashHoldNotifier.new,
);

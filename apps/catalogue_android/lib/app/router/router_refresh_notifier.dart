import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/application/auth_controller.dart';
import 'splash_hold_provider.dart';

/// Bridges Riverpod's [authControllerProvider] (and [splashHoldProvider]) to
/// [GoRouter.refreshListenable] so navigation re-evaluates its redirect
/// whenever auth status changes (login, logout, forced logout from a failed
/// token refresh) or the branded splash's minimum reveal time elapses.
class RouterRefreshNotifier extends ChangeNotifier {
  RouterRefreshNotifier(Ref ref) {
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
    ref.listen(splashHoldProvider, (_, _) => notifyListeners());
  }
}

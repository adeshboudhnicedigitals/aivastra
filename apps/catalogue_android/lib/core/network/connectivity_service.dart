import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The app's one source of truth for "is there a network connection right
/// now" — every screen that needs to react to connectivity (the global
/// [OfflineBanner], a submit button that should refuse to fire, a manual
/// "check connection" retry) reads [isOnlineProvider] rather than touching
/// `connectivity_plus` directly, so the detection logic lives in one place.
///
/// This reports whether the device is attached to a network (Wi-Fi or
/// mobile data) — not whether that network can actually reach the internet,
/// which the OS-level connectivity APIs this wraps can't tell us on their
/// own (a captive portal or a dead Wi-Fi router both read as "connected").
/// A real API call still needs its own error handling for that case; this
/// only covers the common "airplane mode / no signal / Wi-Fi off" case,
/// which is what a proactive banner can act on without making a request.
class ConnectivityService {
  /// Takes the platform lookup and change stream as plain functions rather
  /// than a `Connectivity` instance directly, so a test can supply canned
  /// ones instead of going through the real platform channel.
  ConnectivityService({
    required Future<List<ConnectivityResult>> Function() checkConnectivity,
    required Stream<List<ConnectivityResult>> Function() onConnectivityChanged,
  })
  // Not `this._checkConnectivity` etc: that would make the named
  // parameters private, and thus unusable by name from a test file (a
  // different library) — the whole point of taking these as plain
  // functions instead of a `Connectivity` instance.
  // ignore: prefer_initializing_formals
  : _checkConnectivity = checkConnectivity,
    // ignore: prefer_initializing_formals
    _onConnectivityChanged = onConnectivityChanged;

  factory ConnectivityService.platform() {
    final connectivity = Connectivity();
    return ConnectivityService(
      checkConnectivity: connectivity.checkConnectivity,
      onConnectivityChanged: () => connectivity.onConnectivityChanged,
    );
  }

  final Future<List<ConnectivityResult>> Function() _checkConnectivity;
  final Stream<List<ConnectivityResult>> Function() _onConnectivityChanged;

  bool _isOnline(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  /// The current status, then every change after it.
  Stream<bool> watch() async* {
    yield _isOnline(await _checkConnectivity());
    yield* _onConnectivityChanged().map(_isOnline);
  }
}

final connectivityServiceProvider = Provider<ConnectivityService>(
  (ref) => ConnectivityService.platform(),
);

/// `true`/`false` once the first check resolves; `null` (via `.value`) for
/// the brief moment before that. Callers that need a definite answer before
/// then should treat that as online — see [OfflineBanner], which stays
/// hidden until it's sure there's actually no connection.
final isOnlineProvider = StreamProvider<bool>(
  (ref) => ref.watch(connectivityServiceProvider).watch(),
);

import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Single entry point for Firebase Crashlytics — mirrors
/// apps/virtual_tryon_android's CrashReporter.kt so call sites never touch
/// FirebaseCrashlytics directly and the reporting backend can change in one
/// place. Collection is disabled in debug builds, same reasoning as there:
/// debug runs constantly on developer devices and would drown out real user
/// crashes in the release dashboard.
class CrashReporter {
  CrashReporter._();

  static final FirebaseCrashlytics _crashlytics =
      FirebaseCrashlytics.instance;

  static Future<void> init() async {
    await _crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);
    await _crashlytics.setCustomKey(
      'build_type',
      kDebugMode ? 'debug' : 'release',
    );
    final info = await PackageInfo.fromPlatform();
    await _crashlytics.setCustomKey('version_name', info.version);
    await _crashlytics.setCustomKey('version_code', info.buildNumber);
  }

  /// Associates subsequent crashes/logs with this device's signed-in user
  /// (opaque id, never email).
  static Future<void> setUserId(String? userId) =>
      _crashlytics.setUserIdentifier(userId ?? '');

  /// Breadcrumb visible in the crash/non-fatal timeline leading up to the
  /// event.
  static void log(String message) => _crashlytics.log(message);

  static Future<void> setCustomKey(String key, Object value) =>
      _crashlytics.setCustomKey(key, value);

  /// Reports a caught exception as a non-fatal issue without crashing the
  /// app.
  static Future<void> recordException(
    Object exception,
    StackTrace? stack, {
    String? reason,
  }) {
    if (kDebugMode) debugPrint('CrashReporter: $exception\n$stack');
    return _crashlytics.recordError(exception, stack, reason: reason);
  }
}

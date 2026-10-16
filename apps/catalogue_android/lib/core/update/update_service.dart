import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_update/in_app_update.dart';

/// Thin wrapper over the Play In-App Update API (`in_app_update`), taking
/// the platform calls as plain functions rather than static calls directly —
/// same shape as [ConnectivityService] — so a test can supply canned ones
/// instead of going through the real platform channel, which only exists on
/// a device with Play Services and throws immediately in a widget test.
///
/// Every call here only succeeds for an app installed via the Play Store;
/// anywhere else (debug, Firebase App Distribution, sideloaded APK) it
/// throws, which [AppUpdateNotifier] treats as "nothing to offer" rather
/// than surfacing an error.
class UpdateService {
  UpdateService({
    required Future<AppUpdateInfo> Function() checkForUpdate,
    required Future<AppUpdateResult> Function() startFlexibleUpdate,
    required Future<void> Function() completeFlexibleUpdate,
    required Stream<InstallStatus> Function() installUpdateListener,
  }) // Not `this._checkForUpdate` etc: that would make the named parameters
  // private, and thus unusable by name from a test file (a different
  // library) — the whole point of taking these as plain functions instead
  // of calling the static `InAppUpdate` methods directly.
  // ignore: prefer_initializing_formals
  : _checkForUpdate = checkForUpdate,
    // ignore: prefer_initializing_formals
    _startFlexibleUpdate = startFlexibleUpdate,
    // ignore: prefer_initializing_formals
    _completeFlexibleUpdate = completeFlexibleUpdate,
    // ignore: prefer_initializing_formals
    _installUpdateListener = installUpdateListener;

  factory UpdateService.platform() => UpdateService(
    checkForUpdate: InAppUpdate.checkForUpdate,
    startFlexibleUpdate: InAppUpdate.startFlexibleUpdate,
    completeFlexibleUpdate: InAppUpdate.completeFlexibleUpdate,
    installUpdateListener: () => InAppUpdate.installUpdateListener,
  );

  final Future<AppUpdateInfo> Function() _checkForUpdate;
  final Future<AppUpdateResult> Function() _startFlexibleUpdate;
  final Future<void> Function() _completeFlexibleUpdate;
  final Stream<InstallStatus> Function() _installUpdateListener;

  Future<AppUpdateInfo> checkForUpdate() => _checkForUpdate();

  Future<AppUpdateResult> startFlexibleUpdate() => _startFlexibleUpdate();

  /// Installs the update downloaded via [startFlexibleUpdate] — Play
  /// restarts the app to apply it.
  Future<void> completeFlexibleUpdate() => _completeFlexibleUpdate();

  Stream<InstallStatus> watchInstallStatus() => _installUpdateListener();
}

final updateServiceProvider = Provider<UpdateService>(
  (ref) => UpdateService.platform(),
);

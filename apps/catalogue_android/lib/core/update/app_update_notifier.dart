import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_update/in_app_update.dart';

import 'update_service.dart';

/// What [UpdateBanner] should show. Flexible updates are deliberately quiet
/// until the download is actually done — there's nothing useful for the
/// user to do mid-download, so no "downloading…" state is tracked here.
enum AppUpdateBannerStatus { hidden, readyToInstall }

/// Checks Play for a newer version once per app launch and, if one exists,
/// starts downloading it in the background immediately — no prompt yet.
/// [AppUpdateBannerStatus.readyToInstall] only fires once that download
/// finishes, which is what [UpdateBanner] watches to show its "Update now"
/// banner. This is Phase 1 of the update plan (see docs/progress.md): a
/// low-friction nudge, not a forced/blocking update — that's a separate,
/// backend-driven minimum-version gate for emergency cases, not this.
class AppUpdateNotifier extends Notifier<AppUpdateBannerStatus> {
  StreamSubscription<InstallStatus>? _installSub;

  @override
  AppUpdateBannerStatus build() {
    ref.onDispose(() => _installSub?.cancel());
    // Fire-and-forget: a failed/unavailable check should never block app
    // startup, and there's no loading UI for this — it's a background nicety
    // that either produces a banner later or doesn't.
    unawaited(_checkAndStart());
    return AppUpdateBannerStatus.hidden;
  }

  Future<void> _checkAndStart() async {
    final service = ref.read(updateServiceProvider);
    try {
      final info = await service.checkForUpdate();
      if (info.updateAvailability != UpdateAvailability.updateAvailable ||
          !info.flexibleUpdateAllowed) {
        return;
      }

      _installSub = service.watchInstallStatus().listen((status) {
        if (status == InstallStatus.downloaded) {
          state = AppUpdateBannerStatus.readyToInstall;
        }
      });

      await service.startFlexibleUpdate();
    } catch (_) {
      // Not a Play Store install (debug/Firebase/sideload), no connectivity,
      // or Play itself failed — nothing actionable for the user, so this
      // stays silent rather than surfacing an error for a background nicety.
    }
  }

  /// Installs the update that's already finished downloading — Play
  /// restarts the app. The banner has nothing useful to show after this, so
  /// callers don't need to reset state back to [AppUpdateBannerStatus.hidden].
  Future<void> install() => ref.read(updateServiceProvider).completeFlexibleUpdate();

  void dismiss() => state = AppUpdateBannerStatus.hidden;
}

final appUpdateProvider =
    NotifierProvider<AppUpdateNotifier, AppUpdateBannerStatus>(
      AppUpdateNotifier.new,
    );

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/connectivity_service.dart';
import '../core/update/app_update_notifier.dart';
import '../utils/app_strings.dart';

/// The app's "a new version just finished downloading" nudge — mirrors
/// [OfflineBanner]'s always-mounted, slide-in-from-top shape (see
/// `lib/app/app.dart`), but unlike that one this is interactive: tapping
/// "Restart" calls [AppUpdateNotifier.install], which hands off to Play to
/// relaunch the app on the new version.
///
/// Deliberately quiet: [AppUpdateNotifier] starts the download in the
/// background with no UI at all, and this only appears once it's finished —
/// never a mid-download progress indicator. Phase 1 of the update plan (see
/// docs/progress.md); a forced/blocking update for emergency cases is a
/// separate, backend-driven mechanism, not this banner.
class UpdateBanner extends ConsumerWidget {
  const UpdateBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(appUpdateProvider);
    // Both banners anchor topCenter, so showing this while offline would sit
    // directly under/behind OfflineBanner — and there's nothing to install
    // mid-outage anyway (completeFlexibleUpdate still needs Play), so it
    // just waits for connectivity to return.
    final online = ref.watch(isOnlineProvider).value ?? true;
    final visible = online && status == AppUpdateBannerStatus.readyToInstall;

    return IgnorePointer(
      ignoring: !visible,
      child: Align(
        alignment: Alignment.topCenter,
        child: AnimatedSlide(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutCubic,
          offset: visible ? Offset.zero : const Offset(0, -1.5),
          child: SafeArea(
            bottom: false,
            child: Container(
              width: double.infinity,
              margin: EdgeInsets.symmetric(
                horizontal: AppDimens.sdp(context, '_16sdp'),
              ),
              padding: EdgeInsets.symmetric(
                horizontal: AppDimens.sdp(context, '_14sdp'),
                vertical: AppDimens.sdp(context, '_10sdp'),
              ),
              decoration: BoxDecoration(
                gradient: AppColors.pinkGradient,
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_12sdp'),
                ),
                boxShadow: const [
                  BoxShadow(color: Colors.black38, blurRadius: 8),
                ],
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.system_update_rounded,
                    color: Colors.white,
                    size: AppDimens.sdp(context, '_16sdp'),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  Flexible(
                    child: Text(
                      AppStrings.updateReadyMessage,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  TextButton(
                    onPressed: () =>
                        ref.read(appUpdateProvider.notifier).install(),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.symmetric(
                        horizontal: AppDimens.sdp(context, '_10sdp'),
                      ),
                      minimumSize: const Size(0, 28),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      AppStrings.updateNowLabel,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                  InkWell(
                    onTap: () => ref.read(appUpdateProvider.notifier).dismiss(),
                    customBorder: const CircleBorder(),
                    child: Padding(
                      padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
                      child: Icon(
                        Icons.close_rounded,
                        color: Colors.white,
                        size: AppDimens.sdp(context, '_14sdp'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

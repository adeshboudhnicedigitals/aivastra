import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/connectivity_service.dart';
import '../utils/app_strings.dart';

/// The app's one "you're offline" indicator — a bar that slides in under the
/// status bar the moment [isOnlineProvider] reports no connection, and slides
/// back out the moment it returns, on every screen at once.
///
/// Mounted once, in [App]'s `builder` (`lib/app/app.dart`), on top of
/// whichever screen is showing — no per-screen wiring needed. A screen that
/// wants to *react* to being offline (disable a submit button, skip a fetch)
/// should watch [isOnlineProvider] itself; this widget only shows the message.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Defaults to "online" for the brief moment before the first connectivity
    // check resolves, and if the check ever errors — a banner claiming
    // "offline" on a guess would be worse than briefly missing a real one.
    final online = ref.watch(isOnlineProvider).value ?? true;

    return IgnorePointer(
      child: Align(
        alignment: Alignment.topCenter,
        child: AnimatedSlide(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutCubic,
          offset: online ? const Offset(0, -1.5) : Offset.zero,
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
                color: AppColors.danger,
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_12sdp'),
                ),
                boxShadow: const [
                  BoxShadow(color: Colors.black38, blurRadius: 8),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.wifi_off_rounded,
                    color: Colors.white,
                    size: AppDimens.sdp(context, '_16sdp'),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  Flexible(
                    child: Text(
                      AppStrings.noInternetMessage,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
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

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';

/// Credits-remaining pill, shown in the header of every main screen (Home,
/// Profile, etc.). Kept as a single reusable widget so the credits amount
/// stays visually identical everywhere it appears. Tapping anywhere on it
/// (the count or the add icon) opens Plans & Billing, where credits are
/// actually purchased.
class CreditsBadge extends StatelessWidget {
  const CreditsBadge({super.key, required this.credits});

  /// Null until the first balance has loaded — shows a dash rather than a
  /// misleading 0.
  final int? credits;

  @override
  Widget build(BuildContext context) {
    final addSize = AppDimens.sdp(context, '_26sdp');
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: () => context.push(AppRoutes.plansBilling),
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_12sdp'),
            vertical: AppDimens.sdp(context, '_6sdp'),
          ),
          decoration: BoxDecoration(
            color: AppColors.fieldFill,
            borderRadius: radius,
            border: Border.all(color: AppColors.fieldBorder),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                AppAssets.creditIcon,
                width: AppDimens.sdp(context, '_14sdp'),
                height: AppDimens.sdp(context, '_14sdp'),
                colorFilter: const ColorFilter.mode(
                  Colors.white,
                  BlendMode.srcIn,
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_6sdp')),
              Text(
                credits?.toString() ?? '—',
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_14sdp')),
              SvgPicture.asset(
                AppAssets.addCreditsIcon,
                width: addSize,
                height: addSize,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

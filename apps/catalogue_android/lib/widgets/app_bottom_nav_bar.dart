import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';

class AppBottomNavItem {
  const AppBottomNavItem({required this.iconAsset, required this.label});

  final String iconAsset;
  final String label;
}

const List<AppBottomNavItem> _kDefaultNavItems = [
  AppBottomNavItem(iconAsset: AppAssets.homeIcon, label: AppStrings.navHome),
  AppBottomNavItem(
    iconAsset: AppAssets.myCreationsIcon,
    label: AppStrings.navMyCreations,
  ),
  AppBottomNavItem(
    iconAsset: AppAssets.productsIcon,
    label: AppStrings.navProducts,
  ),
  AppBottomNavItem(
    iconAsset: AppAssets.profileIcon,
    label: AppStrings.navProfile,
  ),
];

/// Floating pill-shaped bottom navigation bar used across the app's main
/// screens. Scales for phone and tablet widths via [AppDimens] and is
/// clamped to the app's shared max content width on large screens.
class AppBottomNavBar extends StatelessWidget {
  const AppBottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.items = _kDefaultNavItems,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final List<AppBottomNavItem> items;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final horizontalMargin = AppDimens.sdp(context, '_16sdp');
    final barHorizontalPadding = AppDimens.sdp(context, '_10sdp');
    final barPadding = EdgeInsets.symmetric(
      horizontal: barHorizontalPadding,
      vertical: AppDimens.sdp(context, '_10sdp'),
    );
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_32sdp'));
    final accentWidth = AppDimens.sdp(context, '_55sdp');
    final accentHeight = AppDimens.sdp(context, '_3sdp');

    return Padding(
      padding: EdgeInsets.fromLTRB(
        horizontalMargin,
        0,
        horizontalMargin,
        bottomInset + AppDimens.sdp(context, '_12sdp'),
      ),
      child: Center(
        // heightFactor: 1 makes Center shrink-wrap to its child's height.
        // Without it, Center expands to fill all available height (Scaffold
        // offers the bottomNavigationBar slot a very generous loose max
        // height), vertically centering the pill in that huge invisible
        // box instead of hugging it to the true bottom of the screen.
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: ClipRRect(
            borderRadius: radius,
            child: LayoutBuilder(
              builder: (context, constraints) {
                // Centers the accent bar over the selected tab's own segment
                // (equal-width Expanded slice of the row), which is exactly
                // where that tab's icon is horizontally centered too. It
                // animates to the newly selected tab on every tap.
                final segmentWidth =
                    (constraints.maxWidth - barHorizontalPadding * 2) /
                    items.length;
                final accentLeft =
                    barHorizontalPadding +
                    (segmentWidth * currentIndex) +
                    (segmentWidth - accentWidth) / 2;

                // IntrinsicHeight keeps the Stack sized to its content's
                // natural height. Without it, Stack's default StackFit.loose
                // sizing expands to fill whatever (large) height Scaffold
                // offers the bottomNavigationBar slot, pushing this whole
                // bar up near the middle of the screen instead of hugging
                // the pill's own height at the true bottom.
                return IntrinsicHeight(
                  child: Stack(
                    children: [
                      Container(
                        padding: barPadding,
                        decoration: BoxDecoration(
                          color: const Color(0xE6141414),
                          borderRadius: radius,
                          border: Border.all(color: AppColors.fieldBorder),
                        ),
                        child: Row(
                          children: List.generate(items.length, (index) {
                            return Expanded(
                              child: _NavItemButton(
                                item: items[index],
                                selected: index == currentIndex,
                                onTap: () => onTap(index),
                              ),
                            );
                          }),
                        ),
                      ),
                      AnimatedPositioned(
                        duration: const Duration(milliseconds: 250),
                        curve: Curves.easeOut,
                        top: 0,
                        left: accentLeft,
                        child: Container(
                          width: accentWidth,
                          height: accentHeight,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(
                              AppDimens.sdp(context, '_2sdp'),
                            ),
                            gradient: const LinearGradient(
                              begin: Alignment.centerLeft,
                              end: Alignment.centerRight,
                              colors: [
                                AppColors.pinkGradientStart,
                                Color(0xFF4C6FF0),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItemButton extends StatelessWidget {
  const _NavItemButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final AppBottomNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? Colors.white
        : Colors.white.withValues(alpha: 0.45);
    final iconSize = AppDimens.sdp(context, '_24sdp');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
        child: Padding(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_8sdp'),
            horizontal: AppDimens.sdp(context, '_4sdp'),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                item.iconAsset,
                width: iconSize,
                height: iconSize,
                colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
              ),
              SizedBox(height: AppDimens.sdp(context, '_6sdp')),
              Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: (selected ? AppTextStyles.bold : AppTextStyles.medium)
                    .copyWith(
                      color: color,
                      fontSize: AppDimens.ssp(context, '_12ssp'),
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

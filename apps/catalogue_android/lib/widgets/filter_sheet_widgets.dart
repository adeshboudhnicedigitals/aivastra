import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_strings.dart';
import 'gradient_button.dart';

/// Shared chrome for a "pick one option per section, then Clear All /
/// Apply Filters" bottom sheet — drag handle, title + close button,
/// scrollable list of [sections], and the footer button row. Used by both
/// the Products and My Creations filter sheets.
class FilterSheetScaffold extends StatelessWidget {
  const FilterSheetScaffold({
    super.key,
    required this.sections,
    required this.onClearAll,
    required this.onApply,
  });

  final List<Widget> sections;
  final VoidCallback onClearAll;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final sidePadding = AppDimens.sdp(context, '_20sdp');
    final sectionGap = AppDimens.sdp(context, '_20sdp');
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(height: AppDimens.sdp(context, '_10sdp')),
            Container(
              width: AppDimens.sdp(context, '_36sdp'),
              height: AppDimens.sdp(context, '_4sdp'),
              decoration: BoxDecoration(
                color: AppColors.fieldBorder,
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_2sdp'),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                sidePadding,
                AppDimens.sdp(context, '_16sdp'),
                sidePadding,
                0,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      AppStrings.filtersTitle,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_18ssp'),
                      ),
                    ),
                  ),
                  InkWell(
                    onTap: () => Navigator.of(context).pop(),
                    customBorder: const CircleBorder(),
                    child: Padding(
                      padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
                      child: Icon(
                        Icons.close_rounded,
                        color: AppColors.textSecondary,
                        size: AppDimens.sdp(context, '_22sdp'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                  sidePadding,
                  AppDimens.sdp(context, '_16sdp'),
                  sidePadding,
                  0,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < sections.length; i++) ...[
                      if (i > 0) SizedBox(height: sectionGap),
                      sections[i],
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                sidePadding,
                AppDimens.sdp(context, '_20sdp'),
                sidePadding,
                AppDimens.sdp(context, '_20sdp'),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinePillButton(
                      label: AppStrings.clearAll,
                      onTap: onClearAll,
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_12sdp')),
                  Expanded(
                    child: GradientButton(
                      label: AppStrings.applyFilters,
                      padding: EdgeInsets.symmetric(
                        vertical: AppDimens.sdp(context, '_14sdp'),
                      ),
                      textStyle: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_14ssp'),
                      ),
                      onPressed: onApply,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A filter sheet section: a title followed by a wrap of single-select
/// [FilterChoiceChip]s.
class FilterSection extends StatelessWidget {
  const FilterSection({
    super.key,
    required this.title,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.icons,
  });

  final String title;
  final List<String> options;
  final String selected;
  final ValueChanged<String> onSelected;
  final Map<String, IconData>? icons;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: AppTextStyles.semiBold.copyWith(
            color: Colors.white,
            fontSize: AppDimens.ssp(context, '_13ssp'),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_10sdp')),
        Wrap(
          spacing: AppDimens.sdp(context, '_8sdp'),
          runSpacing: AppDimens.sdp(context, '_8sdp'),
          children: [
            for (final option in options)
              FilterChoiceChip(
                label: option,
                selected: option == selected,
                icon: icons?[option],
                onTap: () => onSelected(option),
              ),
          ],
        ),
      ],
    );
  }
}

/// Single pill choice inside a [FilterSection]: shows a small pink
/// check-circle when selected, or an optional leading [icon] when not.
class FilterChoiceChip extends StatelessWidget {
  const FilterChoiceChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_12sdp'),
            vertical: AppDimens.sdp(context, '_9sdp'),
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.pinkGradientStart.withValues(alpha: 0.14)
                : AppColors.fieldFill,
            borderRadius: radius,
            border: Border.all(
              color: selected
                  ? AppColors.pinkGradientStart
                  : AppColors.fieldBorder,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (selected) ...[
                Container(
                  width: AppDimens.sdp(context, '_14sdp'),
                  height: AppDimens.sdp(context, '_14sdp'),
                  decoration: const BoxDecoration(
                    color: AppColors.pinkGradientStart,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.check_rounded,
                    color: Colors.white,
                    size: AppDimens.sdp(context, '_10sdp'),
                  ),
                ),
                SizedBox(width: AppDimens.sdp(context, '_6sdp')),
              ] else if (icon != null) ...[
                Icon(
                  icon,
                  color: AppColors.textSecondary,
                  // '_13sdp' isn't a real AppDimens key (the table jumps
                  // 12 -> 14) — the lookup silently fell back to 0,
                  // collapsing this icon to nothing.
                  size: AppDimens.sdp(context, '_14sdp'),
                ),
                SizedBox(width: AppDimens.sdp(context, '_6sdp')),
              ],
              Text(
                label,
                style: AppTextStyles.medium.copyWith(
                  color: selected ? Colors.white : AppColors.textSecondary,
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

/// Plain white-outline pill button, e.g. "Clear All" next to a
/// [GradientButton] "Apply Filters".
class OutlinePillButton extends StatelessWidget {
  const OutlinePillButton({
    super.key,
    required this.label,
    required this.onTap,
  });

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_14sdp'),
          ),
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: Colors.white.withValues(alpha: 0.24)),
          ),
          child: Text(
            label,
            style: AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_14ssp'),
            ),
          ),
        ),
      ),
    );
  }
}

/// The "⚙ Filter" pill button shown next to a search field, with a small
/// pink badge showing the active filter count. Used by Products and My
/// Creations.
class FilterIconButton extends StatelessWidget {
  const FilterIconButton({
    super.key,
    required this.activeCount,
    required this.onTap,
  });

  final int activeCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Material(
          color: Colors.transparent,
          borderRadius: radius,
          child: InkWell(
            onTap: onTap,
            borderRadius: radius,
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: AppDimens.sdp(context, '_14sdp'),
                vertical: AppDimens.sdp(context, '_14sdp'),
              ),
              decoration: BoxDecoration(
                color: AppColors.fieldFill,
                borderRadius: radius,
                border: Border.all(color: AppColors.fieldBorder),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.tune_rounded,
                    color: Colors.white,
                    size: AppDimens.sdp(context, '_16sdp'),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                  Text(
                    AppStrings.filterLabel,
                    style: AppTextStyles.medium.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_12ssp'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (activeCount > 0)
          Positioned(
            top: -AppDimens.sdp(context, '_6sdp'),
            right: -AppDimens.sdp(context, '_6sdp'),
            child: Container(
              constraints: BoxConstraints(
                minWidth: AppDimens.sdp(context, '_18sdp'),
                minHeight: AppDimens.sdp(context, '_18sdp'),
              ),
              padding: EdgeInsets.all(AppDimens.sdp(context, '_2sdp')),
              decoration: const BoxDecoration(
                color: AppColors.pinkGradientStart,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                '$activeCount',
                style: AppTextStyles.bold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_9ssp'),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Removable "Label: Value ✕" chip shown in the active-filters row below
/// the search bar. Used by Products and My Creations.
class RemovableFilterChip extends StatelessWidget {
  const RemovableFilterChip({
    super.key,
    required this.label,
    required this.onRemove,
  });

  final String label;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppDimens.sdp(context, '_10sdp'),
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
          Text(
            label,
            style: AppTextStyles.medium.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_11ssp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_6sdp')),
          GestureDetector(
            onTap: onRemove,
            child: Icon(
              Icons.close_rounded,
              color: AppColors.textSecondary,
              size: AppDimens.sdp(context, '_12sdp'),
            ),
          ),
        ],
      ),
    );
  }
}

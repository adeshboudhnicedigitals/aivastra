import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../models/creation.dart';
import '../utils/app_strings.dart';
import 'filter_sheet_widgets.dart';

/// Opens the My Creations filter sheet pre-filled with [initial]. Returns
/// the applied [CreationFilters] on "Apply Filters", or null if dismissed
/// without applying.
Future<CreationFilters?> showCreationFilterSheet(
  BuildContext context, {
  required CreationFilters initial,
}) {
  return showModalBottomSheet<CreationFilters>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.sheetBackground,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) => _CreationFilterSheet(initial: initial),
  );
}

class _CreationFilterSheet extends StatefulWidget {
  const _CreationFilterSheet({required this.initial});

  final CreationFilters initial;

  @override
  State<_CreationFilterSheet> createState() => _CreationFilterSheetState();
}

class _CreationFilterSheetState extends State<_CreationFilterSheet> {
  late CreationFilters _draft = widget.initial;

  static const _creationTypes = [
    AppStrings.creationTypeAll,
    AppStrings.creationTypeCatalogues,
    AppStrings.creationTypeMotionVideos,
  ];
  static const _categories = [
    AppStrings.filterCategoryAll,
    AppStrings.filterCategoryWomen,
    AppStrings.filterCategoryMen,
    AppStrings.filterCategoryBoy,
    AppStrings.filterCategoryGirl,
  ];
  static const _createdOnOptions = [
    AppStrings.filterCreatedAll,
    AppStrings.filterToday,
    AppStrings.filterYesterday,
    AppStrings.filterThisWeek,
    AppStrings.filterThisMonth,
    AppStrings.filterCustomDate,
  ];

  @override
  Widget build(BuildContext context) {
    return FilterSheetScaffold(
      sections: [
        FilterSection(
          title: AppStrings.creationTypeSection,
          options: _creationTypes,
          selected: _draft.creationType,
          onSelected: (value) =>
              setState(() => _draft = _draft.copyWith(creationType: value)),
        ),
        FilterSection(
          title: AppStrings.categorySection,
          options: _categories,
          selected: _draft.category,
          onSelected: (value) =>
              setState(() => _draft = _draft.copyWith(category: value)),
        ),
        FilterSection(
          title: AppStrings.createdOnSection,
          options: _createdOnOptions,
          selected: _draft.createdOn,
          icons: const {
            AppStrings.filterCustomDate: Icons.calendar_today_rounded,
          },
          onSelected: (value) =>
              setState(() => _draft = _draft.copyWith(createdOn: value)),
        ),
      ],
      onClearAll: () => Navigator.of(context).pop(const CreationFilters()),
      onApply: () => Navigator.of(context).pop(_draft),
    );
  }
}

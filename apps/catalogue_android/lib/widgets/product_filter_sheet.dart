import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../models/product.dart';
import '../utils/app_strings.dart';
import 'filter_sheet_widgets.dart';

/// Opens the Products filter sheet pre-filled with [initial]. Returns the
/// applied [ProductFilters] on "Apply Filters", or null if dismissed
/// without applying.
Future<ProductFilters?> showProductFilterSheet(
  BuildContext context, {
  required ProductFilters initial,
}) {
  return showModalBottomSheet<ProductFilters>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.sheetBackground,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) => _ProductFilterSheet(initial: initial),
  );
}

class _ProductFilterSheet extends StatefulWidget {
  const _ProductFilterSheet({required this.initial});

  final ProductFilters initial;

  @override
  State<_ProductFilterSheet> createState() => _ProductFilterSheetState();
}

class _ProductFilterSheetState extends State<_ProductFilterSheet> {
  late ProductFilters _draft = widget.initial;

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
      onClearAll: () => Navigator.of(context).pop(const ProductFilters()),
      onApply: () => Navigator.of(context).pop(_draft),
    );
  }
}

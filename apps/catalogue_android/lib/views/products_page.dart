import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/utils/relative_date.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/uploaded_asset.dart';
import '../models/product.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/app_refresh_scroll_view.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/filter_sheet_widgets.dart';
import '../widgets/product_filter_sheet.dart';
import 'product_detail_page.dart';

class ProductsPage extends ConsumerStatefulWidget {
  const ProductsPage({super.key});

  @override
  ConsumerState<ProductsPage> createState() => _ProductsPageState();
}

class _ProductsPageState extends ConsumerState<ProductsPage> {
  final _searchController = TextEditingController();
  String _query = '';
  ProductFilters _filters = const ProductFilters();
  bool _filtersApplied = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onQueryChanged);
  }

  @override
  void dispose() {
    _searchController.removeListener(_onQueryChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _onQueryChanged() => setState(() => _query = _searchController.text);

  List<UploadedAsset> _filtered(List<UploadedAsset> assets) {
    final query = _query.trim().toLowerCase();
    return assets.where((asset) {
      final uploadedAt = parseApiDate(asset.uploadedAt);
      final matchesQuery =
          query.isEmpty ||
          formatDateGroup(uploadedAt).toLowerCase().contains(query);
      return matchesQuery &&
          matchesCreatedOnBucket(_filters.createdOn, uploadedAt);
    }).toList();
  }

  Map<String, List<UploadedAsset>> _grouped(List<UploadedAsset> assets) {
    final groups = <String, List<UploadedAsset>>{};
    for (final asset in assets) {
      final group = formatDateGroup(parseApiDate(asset.uploadedAt));
      groups.putIfAbsent(group, () => []).add(asset);
    }
    return groups;
  }

  Future<void> _openFilterSheet() async {
    final result = await showProductFilterSheet(context, initial: _filters);
    if (result == null) return;
    setState(() {
      _filters = result;
      _filtersApplied = !result.isDefault;
    });
  }

  void _clearAllFilters() {
    setState(() {
      _filters = const ProductFilters();
      _filtersApplied = false;
    });
  }

  void _openDetail(UploadedAsset asset) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => ProductDetailPage(asset: asset)));
  }

  Future<void> _refresh() async {
    ref.invalidate(userAssetsProvider);
    ref.invalidate(creditsSummaryProvider);
    await Future.wait([
      awaitQuietly(ref.read(userAssetsProvider.future)),
      awaitQuietly(ref.read(creditsSummaryProvider.future)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = AppDimens.sdp(context, '_16sdp');
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final sectionGap = AppDimens.sdp(context, '_18sdp');
    final gridGap = AppDimens.sdp(context, '_14sdp');

    final assetsAsync = ref.watch(userAssetsProvider);

    return Center(
      heightFactor: 1,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: AppRefreshScrollView.slivers(
          onRefresh: _refresh,
          padding: EdgeInsets.fromLTRB(
            horizontalPadding,
            AppDimens.sdp(context, '_16sdp'),
            horizontalPadding,
            AppDimens.sdp(context, '_112sdp'),
          ),
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              AppStrings.productsTitle,
                              style: AppTextStyles.bold.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_22ssp'),
                              ),
                            ),
                            SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                            Text(
                              AppStrings.productsSubtitle,
                              style: AppTextStyles.regular.copyWith(
                                color: AppColors.textSecondary,
                                fontSize: AppDimens.ssp(context, '_13ssp'),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_12sdp')),
                      Consumer(
                        builder: (context, ref, _) {
                          final credits = ref
                              .watch(creditsSummaryProvider)
                              .value;
                          return CreditsBadge(credits: credits?.balance);
                        },
                      ),
                    ],
                  ),
                  SizedBox(height: sectionGap),
                  Row(
                    children: [
                      Expanded(
                        child: AppSearchField(
                          controller: _searchController,
                          hint: AppStrings.searchProductsHint,
                        ),
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                      FilterIconButton(
                        activeCount: _filtersApplied ? 1 : 0,
                        onTap: _openFilterSheet,
                      ),
                    ],
                  ),
                  if (_filtersApplied) ...[
                    SizedBox(height: AppDimens.sdp(context, '_12sdp')),
                    Wrap(
                      spacing: AppDimens.sdp(context, '_8sdp'),
                      runSpacing: AppDimens.sdp(context, '_8sdp'),
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        RemovableFilterChip(
                          label: 'Created: ${_filters.createdOn}',
                          onRemove: _clearAllFilters,
                        ),
                        GestureDetector(
                          onTap: _clearAllFilters,
                          child: Text(
                            AppStrings.clearAll,
                            style: AppTextStyles.semiBold.copyWith(
                              color: AppColors.pinkGradientStart,
                              fontSize: AppDimens.ssp(context, '_12ssp'),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  SizedBox(height: sectionGap),
                ],
              ),
            ),
            // One list entry per grid row, so cards (and their images) are
            // only built as they scroll into view.
            SliverList.list(
              children: assetsAsync.when(
                loading: () => const [AppLoader.section()],
                error: (_, _) => const [
                  InlineErrorBanner(message: 'Could not load your products.'),
                ],
                data: (assets) =>
                    _buildGrid(context, assets, gridGap, sectionGap),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildGrid(
    BuildContext context,
    List<UploadedAsset> assets,
    double gridGap,
    double sectionGap,
  ) {
    if (assets.isEmpty) {
      return [
        Padding(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_40sdp'),
          ),
          child: Center(
            child: Text(
              AppStrings.noProductsUploadedYet,
              textAlign: TextAlign.center,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
          ),
        ),
      ];
    }

    final groups = _grouped(_filtered(assets));
    if (groups.isEmpty) {
      return [
        Padding(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_40sdp'),
          ),
          child: Center(
            child: Text(
              AppStrings.noProductsFound,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
          ),
        ),
      ];
    }

    return [
      for (final entry in groups.entries) ...[
        Text(
          entry.key,
          style: AppTextStyles.medium.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_11ssp'),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_10sdp')),
        ...ResponsiveGrid.rows(context, spacing: gridGap, [
          for (final asset in entry.value)
            MediaThumbnailCard(
              title: AppStrings.uploadedGarmentTitle,
              tagLabel: AppStrings.uploadedGarmentTag,
              tagColor: AppColors.pinkGradientStart,
              timeAgo: formatTimeAgo(parseApiDate(asset.uploadedAt)),
              icon: Icons.checkroom_rounded,
              tint: AppColors.pinkGradientStart,
              imageUrl: asset.thumbnailUrl,
              // No three-dot menu and no generated-count badge on this grid.
              showMenu: false,
              onTap: () => _openDetail(asset),
            ),
        ]),
        SizedBox(height: sectionGap),
      ],
    ];
  }
}

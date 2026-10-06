import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../core/utils/relative_date.dart';
import '../core/utils/save_media.dart';
import '../features/studio/application/studio_providers.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalog_video_row.dart';
import '../features/studio/data/models/catalogue_summary.dart';
import '../features/studio/data/models/gender.dart';
import '../models/creation.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/app_refresh_scroll_view.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/creation_filter_sheet.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/filter_sheet_widgets.dart';
import 'catalogue_detail_page.dart';
import 'home_page.dart';
import 'motion_detail_page.dart';

/// One catalogue or catalog-video row, normalized into whatever the grid
/// and its filters need — [CatalogueSummary] and [CatalogVideoRow] don't
/// share a domain type, so this is where the two are reconciled.
class _FeedItem {
  const _FeedItem({
    required this.id,
    required this.isVideo,
    required this.createdAt,
    required this.title,
    required this.genderApiValue,
    this.jobIds = const [],
    this.completedJobIds = const [],
    this.imageUrl,
    this.badgeIcon,
    this.badgeLabel,
  });

  factory _FeedItem.fromCatalogue(CatalogueSummary c) {
    final completedCount = c.jobs.where((j) => j.isCompleted).length;
    final hasCover = c.coverUrl != null || c.coverThumbUrl != null;
    final allTerminal = c.jobs.every((j) => j.isTerminal);
    return _FeedItem(
      id: c.catalogueId,
      jobIds: [for (final j in c.jobs) j.id],
      completedJobIds: [
        for (final j in c.jobs)
          if (j.isCompleted) j.id,
      ],
      isVideo: false,
      createdAt: parseApiDate(c.createdAt),
      title: c.garmentType ?? 'Catalogue',
      genderApiValue: c.genderSlug,
      imageUrl: c.coverThumbUrl ?? c.coverUrl,
      badgeIcon: hasCover
          ? Icons.photo_library_outlined
          : (allTerminal
                ? Icons.error_outline_rounded
                : Icons.hourglass_top_rounded),
      badgeLabel: hasCover
          ? '$completedCount'
          : (allTerminal ? 'Failed' : 'Processing'),
    );
  }

  factory _FeedItem.fromCatalogVideo(CatalogVideoRow v) {
    return _FeedItem(
      id: v.id,
      jobIds: [v.id],
      completedJobIds: [if (v.isCompleted) v.id],
      isVideo: true,
      createdAt: parseApiDate(v.createdAt),
      title: 'Motion Video',
      genderApiValue: null,
      imageUrl: v.thumbnailUrl,
      badgeIcon: v.isCompleted
          ? null
          : (v.isFailed
                ? Icons.error_outline_rounded
                : Icons.hourglass_top_rounded),
      // A finished video shows its length ("0:08") in the same badge slot a
      // catalogue uses for its image count — not completed yet falls back
      // to the existing Processing/Failed label, and a pre-duration-field
      // row (duration null) just shows nothing rather than "0:00".
      badgeLabel: v.isCompleted
          ? (v.duration != null ? formatVideoDuration(v.duration!) : null)
          : (v.isFailed ? 'Failed' : 'Processing'),
    );
  }

  final String id;

  /// Every job behind this card (a catalogue has one per look; a video is
  /// itself one job), and the finished subset - what Download can fetch.
  final List<String> jobIds;
  final List<String> completedJobIds;
  final bool isVideo;
  final DateTime createdAt;
  final String title;

  /// null for a video (the catalog-videos endpoint doesn't return one), or
  /// for a legacy catalogue predating gender tracking.
  final String? genderApiValue;
  final String? imageUrl;
  final IconData? badgeIcon;
  final String? badgeLabel;

  String get creationType => isVideo
      ? AppStrings.creationTypeMotionVideos
      : AppStrings.creationTypeCatalogues;
  String get tagLabel =>
      isVideo ? AppStrings.motionVideoTag : AppStrings.catalogueTag;
  Color get tagColor =>
      isVideo ? AppColors.violet : AppColors.pinkGradientStart;
  IconData get icon =>
      isVideo ? Icons.movie_creation_outlined : Icons.checkroom_rounded;
  Color get tint => tagColor;
  String get dateGroup => formatDateGroup(createdAt);
  String get timeAgo => formatTimeAgo(createdAt);

  bool matchesFilters(CreationFilters filters, String query) {
    if (query.isNotEmpty &&
        !title.toLowerCase().contains(query.toLowerCase())) {
      return false;
    }
    if (filters.creationType != AppStrings.creationTypeAll &&
        creationType != filters.creationType) {
      return false;
    }
    if (filters.category != AppStrings.filterCategoryAll) {
      final wanted = Gender.fromDisplayLabel(filters.category).apiValue;
      if (genderApiValue != wanted) return false;
    }
    return matchesCreatedOnBucket(filters.createdOn, createdAt);
  }
}

/// Takes the user to the My Creations tab of the bottom nav bar (used by the
/// "View All" links on the detail pages). Rebuilds the home shell on that tab
/// rather than pushing a second, nav-less copy of the page on top of the
/// detail page.
void pushMyCreationsPage(BuildContext context) {
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const HomePage(initialTabIndex: 1)),
    (route) => false,
  );
}

class MyCreationsPage extends ConsumerStatefulWidget {
  const MyCreationsPage({super.key});

  @override
  ConsumerState<MyCreationsPage> createState() => _MyCreationsPageState();
}

class _MyCreationsPageState extends ConsumerState<MyCreationsPage> {
  final _searchController = TextEditingController();
  String _query = '';
  CreationFilters _filters = const CreationFilters();
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

  Future<void> _openFilterSheet() async {
    final result = await showCreationFilterSheet(context, initial: _filters);
    if (result == null) return;
    setState(() {
      _filters = result;
      _filtersApplied = !result.isDefault;
    });
  }

  void _clearFilter({String? creationType, String? category}) {
    setState(() {
      _filters = _filters.copyWith(
        creationType: creationType,
        category: category,
      );
      _filtersApplied = !_filters.isDefault;
    });
  }

  void _clearAllFilters() {
    setState(() {
      _filters = const CreationFilters();
      _filtersApplied = false;
    });
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// Saves every finished image of a catalogue (or the one video) into the
  /// gallery. Same flow as the result pages: `POST /v1/jobs/:id/download`
  /// for a fresh URL, then the file is saved to Pictures/Movies > AI Vastra.
  Future<void> _downloadItem(_FeedItem item) async {
    final ids = item.completedJobIds;
    if (ids.isEmpty) {
      _toast('Nothing to download yet.');
      return;
    }
    _toast(
      ids.length == 1 ? 'Downloading…' : 'Downloading ${ids.length} images…',
    );
    final repository = ref.read(studioRepositoryProvider);
    var saved = 0;
    for (final id in ids) {
      try {
        final presigned = await repository.downloadJob(id);
        try {
          await saveRemoteMediaToGallery(
            url: presigned.url,
            baseName: 'aivastra-${id.substring(0, 8)}',
            isVideo: item.isVideo,
          );
          saved++;
        } catch (_) {
          // Gallery save unavailable (e.g. Android 9 or older): fall back to
          // the system browser, which can still download the file.
          await launchUrl(
            Uri.parse(presigned.url),
            mode: LaunchMode.externalApplication,
          );
        }
      } catch (_) {
        // Keep going - one failure should not stop the rest.
      }
    }
    _toast(
      saved == ids.length
          ? (saved == 1
                ? 'Saved to your gallery'
                : 'Saved $saved images to your gallery')
          : saved == 0
          ? 'Could not download. Please try again.'
          : 'Saved $saved of ${ids.length} images',
    );
  }

  /// Deletes a creation with the same call the web app uses -
  /// `DELETE /v1/jobs/:id` - once per job (the server has no catalogue-level
  /// delete; a catalogue is just its jobs). The server refuses jobs that are
  /// still generating, which are reported rather than silently kept.
  Future<void> _deleteItem(_FeedItem item) async {
    final what = item.isVideo ? 'video' : 'catalogue';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: Text(
          'Delete this $what?',
          style: const TextStyle(color: Colors.white),
        ),
        content: Text(
          item.jobIds.length > 1
              ? 'All ${item.jobIds.length} images in it will be removed. This cannot be undone.'
              : 'This cannot be undone.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(
              'Delete',
              style: TextStyle(color: AppColors.pinkGradientStart),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final repository = ref.read(studioRepositoryProvider);
    var failed = 0;
    String? firstError;
    for (final id in item.jobIds) {
      try {
        await repository.deleteJob(id);
      } on AppException catch (e) {
        failed++;
        firstError ??= e.when(
          badRequest: (m) => m,
          unauthorized: (m) => m,
          emailNotVerified: (m) => m,
          forbidden: (m) => m,
          deviceLimitReached: (m, _, _, _) => m,
          invalidRefresh: (m) => m,
          rateLimited: (m) => m,
          network: (m) => m,
          server: (m) => m,
          unknown: (m) => m,
        );
      } catch (_) {
        failed++;
      }
    }
    ref.invalidate(allCataloguesProvider);
    ref.invalidate(userCataloguesProvider);
    ref.invalidate(userCatalogVideosProvider);
    _toast(
      failed == 0
          ? 'Deleted'
          // The server's own reason (e.g. "cannot delete an active job" for
          // one still generating) rather than a guessed one.
          : 'Could not delete $failed of ${item.jobIds.length}'
                '${firstError == null ? '' : ': $firstError'}',
    );
  }

  void _openDetail(_FeedItem item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => item.isVideo
            ? MotionDetailPage(jobId: item.id)
            : CatalogueDetailPage(catalogueId: item.id),
      ),
    );
  }

  Future<void> _refresh() async {
    ref.invalidate(allCataloguesProvider);
    ref.invalidate(userCataloguesProvider);
    ref.invalidate(userCatalogVideosProvider);
    ref.invalidate(creditsSummaryProvider);
    await Future.wait([
      awaitQuietly(ref.read(allCataloguesProvider.future)),
      awaitQuietly(ref.read(userCatalogVideosProvider.future)),
      awaitQuietly(ref.read(creditsSummaryProvider.future)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = AppDimens.sdp(context, '_16sdp');
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final sectionGap = AppDimens.sdp(context, '_18sdp');
    final gridGap = AppDimens.sdp(context, '_14sdp');

    final cataloguesAsync = ref.watch(allCataloguesProvider);
    final videosAsync = ref.watch(userCatalogVideosProvider);

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
                              AppStrings.myCreationsTitle,
                              style: AppTextStyles.bold.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_22ssp'),
                              ),
                            ),
                            SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                            Text(
                              AppStrings.myCreationsSubtitle,
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
                          hint: AppStrings.searchCreationsHint,
                        ),
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                      FilterIconButton(
                        activeCount: _filtersApplied ? 2 : 0,
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
                          label: 'Type: ${_filters.creationType}',
                          onRemove: () => _clearFilter(
                            creationType: AppStrings.creationTypeAll,
                          ),
                        ),
                        RemovableFilterChip(
                          label: 'Category: ${_filters.category}',
                          onRemove: () => _clearFilter(
                            category: AppStrings.filterCategoryAll,
                          ),
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
              children: [
                // Only the very first load shows the spinner. A refresh, or
                // the reload after a delete, already has a list to keep on
                // screen — and videos, the slower and optional half, join
                // the grid when they arrive rather than holding it back.
                if (!cataloguesAsync.hasValue && cataloguesAsync.isLoading)
                  const AppLoader.section()
                else if (!cataloguesAsync.hasValue && cataloguesAsync.hasError)
                  const InlineErrorBanner(
                    message: 'Could not load your creations.',
                  )
                else
                  ..._buildFeed(
                    context,
                    catalogues: cataloguesAsync.value ?? const [],
                    videos: videosAsync.value ?? const [],
                    gridGap: gridGap,
                    sectionGap: sectionGap,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildFeed(
    BuildContext context, {
    required List<CatalogueSummary> catalogues,
    required List<CatalogVideoRow> videos,
    required double gridGap,
    required double sectionGap,
  }) {
    final items = [
      ...catalogues.map(_FeedItem.fromCatalogue),
      ...videos.map(_FeedItem.fromCatalogVideo),
    ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    final query = _query.trim();
    final filtered = items
        .where((item) => item.matchesFilters(_filters, query))
        .toList();

    final groups = <String, List<_FeedItem>>{};
    for (final item in filtered) {
      groups.putIfAbsent(item.dateGroup, () => []).add(item);
    }

    if (_filtersApplied || query.isNotEmpty) {
      return [
        Text(
          AppStrings.resultsFound(filtered.length),
          style: AppTextStyles.medium.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_12ssp'),
          ),
        ),
        SizedBox(height: sectionGap),
        ..._buildGroups(context, groups, gridGap, sectionGap),
      ];
    }

    return _buildGroups(context, groups, gridGap, sectionGap);
  }

  List<Widget> _buildGroups(
    BuildContext context,
    Map<String, List<_FeedItem>> groups,
    double gridGap,
    double sectionGap,
  ) {
    if (groups.isEmpty) {
      return [
        Padding(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_40sdp'),
          ),
          child: Center(
            child: Text(
              AppStrings.noCreationsFound,
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
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(
              entry.key,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_11ssp'),
              ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_10sdp')),
            Expanded(child: Container(height: 1, color: AppColors.fieldBorder)),
          ],
        ),
        SizedBox(height: AppDimens.sdp(context, '_14sdp')),
        ...ResponsiveGrid.rows(context, spacing: gridGap, [
          for (final item in entry.value)
            MediaThumbnailCard(
              title: item.title,
              tagLabel: item.tagLabel,
              tagColor: item.tagColor,
              timeAgo: item.timeAgo,
              icon: item.icon,
              tint: item.tint,
              imageUrl: item.imageUrl,
              badgeIcon: item.badgeIcon,
              badgeLabel: item.badgeLabel,
              centerIcon: item.isVideo ? Icons.play_circle_fill_rounded : null,
              onTap: () => _openDetail(item),
              onDownload: () => _downloadItem(item),
              onDelete: () => _deleteItem(item),
            ),
        ]),
        SizedBox(height: sectionGap),
      ],
    ];
  }
}

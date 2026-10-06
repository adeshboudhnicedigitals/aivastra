import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/studio/application/catalogue_result_controller.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalogue_summary.dart';
import '../features/studio/data/models/job_row.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import '../core/utils/relative_date.dart';
import 'catalogue_actions.dart';
import 'home_page.dart';
import 'my_creations_page.dart';

/// A catalogue opened from My Creations. A separate screen from the
/// generation result page (`CatalogueResultPage`, "Your Catalogue is Ready!"):
/// no card around the image, the action buttons sit in a row under it, and it
/// ends with Recent Creations. The behaviour behind the buttons is shared via
/// [CatalogueActions].
class CatalogueDetailPage extends ConsumerStatefulWidget {
  const CatalogueDetailPage({super.key, required this.catalogueId});

  final String catalogueId;

  @override
  ConsumerState<CatalogueDetailPage> createState() =>
      _CatalogueDetailPageState();
}

class _CatalogueDetailPageState extends ConsumerState<CatalogueDetailPage>
    with CatalogueActions<CatalogueDetailPage> {
  @override
  String get catalogueId => widget.catalogueId;

  @override
  Widget build(BuildContext context) {
    final resultAsync = ref.watch(
      catalogueResultControllerProvider(catalogueId),
    );
    final detail = resultAsync.value;
    final gap = AppDimens.sdp(context, '_14sdp');

    // HomePage rather than a bare studio page: it supplies the Scaffold the
    // studio widgets need.
    void goCreateNew() => Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomePage()),
      (route) => false,
    );

    return DetailPageScaffold(
      title: detail?.garmentName ?? 'Catalogue',
      subtitle: null,
      headerTrailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Consumer(
            builder: (context, ref, _) {
              final credits = ref.watch(creditsSummaryProvider).value;
              return CreditsBadge(credits: credits?.balance);
            },
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          AppPillButton(
            label: AppStrings.createNew,
            trailingIcon: Icons.arrow_right_alt_rounded,
            style: AppPillButtonStyle.highlight,
            onTap: goCreateNew,
          ),
        ],
      ),
      children: [
        resultAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) => const InlineErrorBanner(
            message: 'Could not load this catalogue.',
          ),
          data: (detail) {
            final jobs = detail.jobs;
            if (jobs.isEmpty) {
              return const InlineErrorBanner(
                message: 'No images in this catalogue yet.',
              );
            }
            final index = selectedIndex.clamp(0, jobs.length - 1);
            final job = jobs[index];
            final resultUrl = job.isCompleted
                ? ref.watch(jobResultUrlProvider(job.id)).value
                : null;
            // The server refuses to regenerate a downloaded image (web hides
            // the button too), so it is offered only for finished,
            // not-yet-downloaded ones.
            final canRegenerate =
                job.isCompleted && job.alreadyDownloaded != true;

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                JobHeroCard(
                  job: job,
                  resultUrl: resultUrl,
                  aspectRatio: 0.92,
                  canRegenerate: canRegenerate,
                  onDownload: () => downloadJob(job),
                  onRegenerate: () => regenerate(job),
                  onFullscreen: () => openFullscreen(jobs, index),
                  onPrevious: jobs.length > 1
                      ? () => setState(
                          () => selectedIndex =
                              (index - 1 + jobs.length) % jobs.length,
                        )
                      : null,
                  onNext: jobs.length > 1
                      ? () => setState(
                          () => selectedIndex = (index + 1) % jobs.length,
                        )
                      : null,
                ),
                if (jobs.length > 1) ...[
                  SizedBox(height: AppDimens.sdp(context, '_12sdp')),
                  _ThumbnailStrip(
                    jobs: jobs,
                    selectedIndex: index,
                    onSelect: (i) => setState(() => selectedIndex = i),
                    onLongPress: (j) => deleteJob(j, jobs.length),
                  ),
                ],
                SizedBox(height: gap),
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: AppPillButton(
                        label: AppStrings.download,
                        icon: Icons.download_rounded,
                        style: AppPillButtonStyle.filled,
                        onTap: job.isCompleted ? () => downloadJob(job) : () {},
                      ),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                    Expanded(
                      flex: 6,
                      child: AppPillButton(
                        label: AppStrings.regenerate,
                        icon: Icons.repeat_rounded,
                        style: AppPillButtonStyle.tonal,
                        onTap: canRegenerate
                            ? () => regenerate(job)
                            : () => toast(
                                job.alreadyDownloaded == true
                                    ? 'A downloaded image cannot be regenerated.'
                                    : 'Available once the image is ready.',
                              ),
                      ),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                    Expanded(
                      flex: 4,
                      child: AppPillButton(
                        label: AppStrings.share,
                        icon: Icons.share_outlined,
                        style: AppPillButtonStyle.tonal,
                        onTap: job.isCompleted ? () => shareJob(job) : () {},
                      ),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                    Expanded(
                      flex: 4,
                      child: AppPillButton(
                        label: AppStrings.delete,
                        icon: Icons.delete_outline_rounded,
                        style: AppPillButtonStyle.tonal,
                        onTap: () => deleteJob(job, jobs.length),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: gap),
                BorderedCard(
                  padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
                  child: Row(
                    children: [
                      Container(
                        width: AppDimens.sdp(context, '_40sdp'),
                        height: AppDimens.sdp(context, '_40sdp'),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.35),
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.fieldBorder),
                        ),
                        alignment: Alignment.center,
                        child: Icon(
                          Icons.bookmark_border_rounded,
                          color: AppColors.pinkGradientStart,
                          size: AppDimens.sdp(context, '_18sdp'),
                        ),
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              AppStrings.saveLookAsPreset,
                              style: AppTextStyles.semiBold.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_12ssp'),
                              ),
                            ),
                            SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                            Text(
                              AppStrings.saveLookAsPresetSubtitle,
                              style: AppTextStyles.regular.copyWith(
                                color: AppColors.textSecondary,
                                fontSize: AppDimens.ssp(context, '_10ssp'),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                      // A catalogue opened from My Creations doesn't carry the
                      // garment type / poses it was made with (the detail
                      // endpoint doesn't return them), so the preset can only
                      // be saved right after generating.
                      AppPillButton(
                        label: AppStrings.saveAsPreset,
                        icon: Icons.bookmark_border_rounded,
                        style: AppPillButtonStyle.outline,
                        onTap: () => toast(
                          'Save a look as a preset right after generating it.',
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: gap),
                _RecentCreations(excludeCatalogueId: catalogueId),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// Four thumbnails across (more scroll), nearly square, pink border on the
/// selected one. Long-press deletes, as elsewhere.
class _ThumbnailStrip extends StatelessWidget {
  const _ThumbnailStrip({
    required this.jobs,
    required this.selectedIndex,
    required this.onSelect,
    required this.onLongPress,
  });

  final List<JobRow> jobs;
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final ValueChanged<JobRow> onLongPress;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final gap = AppDimens.sdp(context, '_8sdp');
        final tileWidth = (constraints.maxWidth - gap * 3) / 4;
        final tileHeight = tileWidth * 1.05;
        return SizedBox(
          height: tileHeight,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: jobs.length,
            separatorBuilder: (_, _) => SizedBox(width: gap),
            itemBuilder: (context, i) {
              final job = jobs[i];
              return GestureDetector(
                onLongPress: () => onLongPress(job),
                child: Consumer(
                  builder: (context, ref, _) {
                    final thumbUrl = job.isCompleted
                        ? ref.watch(jobThumbnailUrlProvider(job.id)).value
                        : null;
                    return SelectableThumbnailTile(
                      icon: job.isFailed
                          ? Icons.error_outline_rounded
                          : Icons.checkroom_rounded,
                      imageUrl: thumbUrl,
                      tint: AppColors.pinkGradientStart,
                      width: tileWidth,
                      height: tileHeight,
                      radius: AppDimens.sdp(context, '_8sdp'),
                      selected: i == selectedIndex,
                      showCheck: false,
                      onTap: () => onSelect(i),
                    );
                  },
                ),
              );
            },
          ),
        );
      },
    );
  }
}

/// The user's other catalogues, newest first, four across, in their own card.
class _RecentCreations extends ConsumerWidget {
  const _RecentCreations({required this.excludeCatalogueId});

  final String excludeCatalogueId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(allCataloguesProvider).value ?? const [];
    final recent =
        (all
                .where((c) => c.catalogueId != excludeCatalogueId)
                .where((c) => c.coverThumbUrl != null || c.coverUrl != null)
                .toList()
              ..sort(
                (a, b) =>
                    parseApiDate(b.createdAt)
                        .compareTo(parseApiDate(a.createdAt)),
              ))
            .take(4)
            .toList();
    if (recent.isEmpty) return const SizedBox.shrink();

    final gap = AppDimens.sdp(context, '_8sdp');

    return BorderedCard(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  AppStrings.recentCreationsSection,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_14ssp'),
                  ),
                ),
              ),
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => pushMyCreationsPage(context),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppStrings.viewAll,
                      style: AppTextStyles.medium.copyWith(
                        color: AppColors.pinkGradientStart,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.pinkGradientStart,
                      size: AppDimens.sdp(context, '_16sdp'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_12sdp')),
          LayoutBuilder(
            builder: (context, constraints) {
              final tileWidth = (constraints.maxWidth - gap * 3) / 4;
              return Row(
                children: [
                  for (var i = 0; i < recent.length; i++) ...[
                    if (i > 0) SizedBox(width: gap),
                    _RecentTile(
                      catalogue: recent[i],
                      width: tileWidth,
                      height: tileWidth / 0.72,
                    ),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _RecentTile extends StatelessWidget {
  const _RecentTile({
    required this.catalogue,
    required this.width,
    required this.height,
  });

  final CatalogueSummary catalogue;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final url = catalogue.coverThumbUrl ?? catalogue.coverUrl;

    return GestureDetector(
      onTap: () => Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) =>
              CatalogueDetailPage(catalogueId: catalogue.catalogueId),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_8sdp')),
        child: SizedBox(
          width: width,
          height: height,
          child: url == null
              ? const ColoredBox(color: AppColors.fieldFill)
              : AppNetworkImage(
                  url,
                  thumbnail: true,
                  errorBuilder: (_) =>
                      const ColoredBox(color: AppColors.fieldFill),
                ),
        ),
      ),
    );
  }
}

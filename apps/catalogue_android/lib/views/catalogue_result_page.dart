import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/studio/application/catalogue_result_controller.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import 'catalogue_actions.dart';
import 'home_page.dart';

class CatalogueResultPage extends ConsumerStatefulWidget {
  const CatalogueResultPage({
    super.key,
    required this.catalogueId,
    this.gender,
    this.garmentTypeId,
    this.poseIds,
  });

  final String catalogueId;

  /// Carried over from the tryon submit response so "Save as Preset" doesn't
  /// need a second fetch — the catalogue-detail endpoint doesn't return
  /// garmentTypeId/poseIds on its own.
  final String? gender;
  final String? garmentTypeId;
  final List<String>? poseIds;

  @override
  ConsumerState<CatalogueResultPage> createState() =>
      _CatalogueResultPageState();
}

class _CatalogueResultPageState extends ConsumerState<CatalogueResultPage>
    with CatalogueActions<CatalogueResultPage> {
  @override
  String get catalogueId => widget.catalogueId;

  @override
  Widget build(BuildContext context) {
    final resultAsync = ref.watch(
      catalogueResultControllerProvider(widget.catalogueId),
    );

    // HomePage, not bare StudioHomePage — the latter has no Scaffold of its
    // own (it's meant to live inside HomePage's), so widgets like Motion
    // Studio's AppTextField would throw "No Material widget found" the
    // moment the user reached them.
    void goCreateNew() => Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomePage()),
      (route) => false,
    );

    final detailJobs = resultAsync.value?.jobs;
    final bottomBar = detailJobs == null
        ? null
        : Row(
            children: [
              Expanded(
                child: AppPillButton(
                  label: AppStrings.tryMotion,
                  icon: Icons.movie_creation_outlined,
                  style: AppPillButtonStyle.tonal,
                  onTap: () {
                    // The image being viewed, if it's finished; otherwise
                    // the first finished one.
                    final viewed = detailJobs.isEmpty
                        ? null
                        : detailJobs[selectedIndex.clamp(
                            0,
                            detailJobs.length - 1,
                          )];
                    final source = viewed != null && viewed.isCompleted
                        ? viewed
                        : detailJobs.where((j) => j.isCompleted).firstOrNull;
                    if (source == null) {
                      toast(
                        'Motion needs a finished image — hang on a moment.',
                      );
                      return;
                    }
                    // Straight to the Motion Studio tab on the home screen,
                    // with this image already chosen as the source.
                    Navigator.of(context).pushAndRemoveUntil(
                      MaterialPageRoute(
                        builder: (_) =>
                            HomePage(initialMotionSourceJobId: source.id),
                      ),
                      (route) => false,
                    );
                  },
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_12sdp')),
              Expanded(
                child: AppPillButton(
                  label: AppStrings.createNew,
                  trailingIcon: Icons.arrow_forward_rounded,
                  style: AppPillButtonStyle.filled,
                  onTap: goCreateNew,
                ),
              ),
            ],
          );

    return DetailPageScaffold(
      // Always the fixed page title — the garment name has its own row
      // below (next to Share/Download All), not swapped in up here.
      title: AppStrings.catalogueReadyTitle,
      subtitle: null,
      bottomBar: bottomBar,
      headerTrailing: Consumer(
        builder: (context, ref, _) {
          final credits = ref.watch(creditsSummaryProvider).value;
          return CreditsBadge(credits: credits?.balance);
        },
      ),
      children: [
        resultAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) => const InlineErrorBanner(
            message: 'Could not load this catalogue.',
          ),
          data: (detail) {
            final jobs = detail.jobs;
            final index = jobs.isEmpty
                ? 0
                : selectedIndex.clamp(0, jobs.length - 1);
            final selectedJob = jobs.isEmpty ? null : jobs[index];
            final resultUrl = selectedJob != null && selectedJob.isCompleted
                ? ref.watch(jobResultUrlProvider(selectedJob.id)).value
                : null;

            final hasCompleted = jobs.any((j) => j.isCompleted);

            final canAct = selectedJob != null && selectedJob.isCompleted;

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Name row, hero and thumbnail strip share one bordered card.
                BorderedCard(
                  padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              detail.garmentName ??
                                  AppStrings.catalogueReadyTitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.semiBold.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_15ssp'),
                              ),
                            ),
                          ),
                          SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                          CircleIconButton(
                            icon: Icons.share_outlined,
                            onTap: canAct ? () => shareJob(selectedJob) : () {},
                          ),
                          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                          AppPillButton(
                            label: AppStrings.downloadAll,
                            icon: Icons.download_rounded,
                            style: AppPillButtonStyle.outline,
                            // AppPillButton has no disabled state (onTap is a
                            // plain, non-nullable VoidCallback) — no-op
                            // instead when nothing is downloadable yet.
                            onTap: hasCompleted
                                ? () => downloadAll(jobs)
                                : () {},
                          ),
                        ],
                      ),
                      SizedBox(height: AppDimens.sdp(context, '_12sdp')),
                      if (selectedJob == null)
                        const InlineErrorBanner(
                          message: 'No images in this catalogue yet.',
                        )
                      else
                        JobHeroCard(
                          job: selectedJob,
                          resultUrl: resultUrl,
                          onDownload: () => downloadJob(selectedJob),
                          // The server refuses to regenerate a job that's
                          // been downloaded (and web hides the button), so
                          // only offer it for finished, not-yet-downloaded
                          // images.
                          canRegenerate:
                              selectedJob.isCompleted &&
                              selectedJob.alreadyDownloaded != true,
                          onRegenerate: () => regenerate(selectedJob),
                          onFullscreen: () => openFullscreen(jobs, index),
                          onPrevious: jobs.length > 1
                              ? () => setState(
                                  () => selectedIndex =
                                      (index - 1 + jobs.length) % jobs.length,
                                )
                              : null,
                          onNext: jobs.length > 1
                              ? () => setState(
                                  () =>
                                      selectedIndex = (index + 1) % jobs.length,
                                )
                              : null,
                        ),
                      if (jobs.length > 1) ...[
                        SizedBox(height: AppDimens.sdp(context, '_12sdp')),
                        LayoutBuilder(
                          builder: (context, constraints) {
                            // Four tiles fill the card's inner width exactly
                            // (further ones scroll in); landscape crop, per
                            // the reference design.
                            final gap = AppDimens.sdp(context, '_8sdp');
                            final tileWidth =
                                (constraints.maxWidth - gap * 3) / 4;
                            final tileHeight = tileWidth * 0.77;
                            return SizedBox(
                              height: tileHeight,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: jobs.length,
                                separatorBuilder: (_, _) =>
                                    SizedBox(width: gap),
                                itemBuilder: (context, i) {
                                  final job = jobs[i];
                                  return GestureDetector(
                                    // Long-press to delete — same convention
                                    // as saved pose presets elsewhere in the
                                    // app.
                                    onLongPress: () =>
                                        deleteJob(job, jobs.length),
                                    child: Consumer(
                                      builder: (context, ref, _) {
                                        final thumbUrl = job.isCompleted
                                            ? ref
                                                  .watch(
                                                    jobThumbnailUrlProvider(
                                                      job.id,
                                                    ),
                                                  )
                                                  .value
                                            : null;
                                        return SelectableThumbnailTile(
                                          icon: job.isFailed
                                              ? Icons.error_outline_rounded
                                              : Icons.checkroom_rounded,
                                          imageUrl: thumbUrl,
                                          tint: AppColors.pinkGradientStart,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_8sdp',
                                          ),
                                          selected: i == index,
                                          showCheck: false,
                                          onTap: () =>
                                              setState(() => selectedIndex = i),
                                        );
                                      },
                                    ),
                                  );
                                },
                              ),
                            );
                          },
                        ),
                      ],
                    ],
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_16sdp')),
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
                      AppPillButton(
                        label: AppStrings.saveAsPreset,
                        icon: Icons.bookmark_border_rounded,
                        style: AppPillButtonStyle.outline,
                        onTap: () => saveAsPreset(
                          widget.gender ?? detail.gender,
                          widget.garmentTypeId,
                          widget.poseIds,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

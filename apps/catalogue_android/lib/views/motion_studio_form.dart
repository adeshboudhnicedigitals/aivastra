import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../core/utils/list_ordering.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../features/studio/application/motion_selection_controller.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';
import 'motion_result_page.dart';

class MotionStudioForm extends ConsumerStatefulWidget {
  const MotionStudioForm({super.key, this.initialSourceJobId});

  /// Prefills the source when arriving from a completed catalogue's
  /// "Try Motion" action.
  final String? initialSourceJobId;

  @override
  ConsumerState<MotionStudioForm> createState() => _MotionStudioFormState();
}

class _MotionStudioFormState extends ConsumerState<MotionStudioForm> {
  final _picker = ImagePicker();
  File? _sourceFile;
  String? _submitError;
  bool _isSubmitting = false;
  bool _appliedInitialSource = false;

  Future<void> _browseImage() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    setState(() => _sourceFile = File(picked.path));
    await ref
        .read(motionSelectionControllerProvider.notifier)
        .pickAndUploadSource(File(picked.path));
  }

  Future<void> _selectCatalogue() async {
    final cataloguesAsync = ref.read(userCataloguesProvider);
    // Already filtered to catalogues with at least one completed job — see
    // userCataloguesProvider's own doc comment.
    final catalogues = cataloguesAsync.value ?? [];

    // Matches the web app's own "Browse Catalogues" picker
    // (CataloguePickerModal.tsx) exactly: every completed job is its own
    // selectable image, flattened across all catalogues and sorted
    // newest-first — not one tile per catalogue. A catalogue with several
    // completed looks (e.g. multiple poses) offers every one of them here,
    // not just its cover/first job.
    final jobs = <({String jobId, DateTime createdAt})>[
      for (final catalogue in catalogues)
        for (final job in catalogue.jobs)
          if (job.isCompleted)
            (
              jobId: job.id,
              createdAt: DateTime.tryParse(job.createdAt) ?? DateTime(0),
            ),
    ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (jobs.isEmpty) return;

    final pickedJobId = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.sheetBackground,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
        ),
      ),
      builder: (sheetContext) =>
          _CataloguePickerSheet(jobIds: jobs.map((j) => j.jobId).toList()),
    );
    if (pickedJobId == null) return;
    setState(() => _sourceFile = null);
    ref
        .read(motionSelectionControllerProvider.notifier)
        .selectSourceJob(pickedJobId);
  }

  Future<void> _generate() async {
    setState(() {
      _isSubmitting = true;
      _submitError = null;
    });
    try {
      final selection = ref.read(motionSelectionControllerProvider);
      final jobId = await ref
          .read(motionSelectionControllerProvider.notifier)
          .submit();
      if (!mounted) return;
      // The image the video was made from, for the result page's details.
      final ImageProvider? sourceImage;
      if (_sourceFile != null) {
        sourceImage = FileImage(_sourceFile!);
      } else if (selection.sourceJobId != null) {
        final thumbUrl = ref
            .read(jobThumbnailUrlProvider(selection.sourceJobId!))
            .value;
        sourceImage = thumbUrl == null ? null : appImageProvider(thumbUrl);
      } else {
        sourceImage = null;
      }
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => MotionResultPage(
            jobId: jobId,
            title: selection.selectedSample?.title,
            promptText: selection.selectedSample?.prompt ?? '',
            duration: selection.duration,
            quality: selection.quality,
            sourceImage: sourceImage,
          ),
        ),
      );
      // Submitted — start the form fresh for next time.
      ref.read(motionSelectionControllerProvider.notifier).clearSource();
      setState(() => _sourceFile = null);
    } on AppException catch (e) {
      setState(() => _submitError = _messageOf(e));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  String _messageOf(AppException e) => e.when(
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

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_18sdp');
    final fieldGap = AppDimens.sdp(context, '_12sdp');
    // '_104sdp' isn't a key AppDimens defines (only _100/_106 nearby) and
    // silently resolved to 0, collapsing this thumbnail row — _106sdp is
    // the closest defined value.
    final presetRowHeight = AppDimens.sdp(context, '_106sdp');

    final selection = ref.watch(motionSelectionControllerProvider);
    final controller = ref.read(motionSelectionControllerProvider.notifier);

    if (!_appliedInitialSource && widget.initialSourceJobId != null) {
      _appliedInitialSource = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        controller.selectSourceJob(widget.initialSourceJobId!);
      });
    }

    final sampleVideosAsync = ref.watch(sampleVideosProvider);

    // A source picked via "Select Catalogue" has no local File — resolve its
    // actual result image so the upload area shows the real photo instead of
    // a generic "Source ready" checkmark.
    final sourceJobId = selection.sourceJobId;
    final sourceThumbUrl = sourceJobId != null
        ? ref.watch(jobThumbnailUrlProvider(sourceJobId)).value
        : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        BorderedCard(
          child: _UploadImageSection(
            sourceFile: _sourceFile,
            hasSourceJob: selection.sourceJobId != null,
            sourceThumbUrl: sourceThumbUrl,
            uploading: selection.isUploadingSource,
            onBrowseImage: _browseImage,
            onSelectCatalogue: _selectCatalogue,
            onClear: () {
              setState(() => _sourceFile = null);
              controller.clearSource();
            },
          ),
        ),
        SizedBox(height: sectionGap),
        // Ready-Made is the only mode this app exposes — no Create Your Own
        // toggle, so this card always shows.
        BorderedCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const WizardStepHeader(
                number: 1,
                title: AppStrings.motionPresetStep,
              ),
              SizedBox(height: sectionGap),
              sampleVideosAsync.when(
                loading: () => SizedBox(
                  height: presetRowHeight,
                  child: const AppLoader(),
                ),
                error: (error, stack) {
                  // A non-network failure here is a response this app
                  // couldn't read; the generic banner alone hid which field.
                  if (error is! AppException) {
                    debugPrint('Motion presets failed to load: $error\n$stack');
                  }
                  return InlineErrorBanner(
                    message: error is AppException
                        ? _messageOf(error)
                        : 'Motion presets are unavailable right now.',
                  );
                },
                data: (response) {
                  // Selected preset first, so a pick made in the "More" sheet
                  // lands in the always-visible slots (same as Catalogue
                  // Studio's rows).
                  final selectedId = selection.selectedSample?.id;
                  final samples = withSelectedFirst(
                    response.items,
                    (s) => s.id,
                    {?selectedId},
                  );
                  // Same capped-row-plus-"More"-sheet pattern as every
                  // other picker in Catalogue Studio: a long unbounded
                  // horizontal ListView made this row feel like it flew
                  // by on a quick swipe — capping the visible count fixes
                  // that and gives "More" a real destination for the rest.
                  return LimitedThumbnailRow(
                    itemCount: samples.length,
                    spacing: AppDimens.sdp(context, '_10sdp'),
                    // This row's tiles show a caption (the preset title)
                    // below the image, unlike every other
                    // LimitedThumbnailRow in the app — without this the
                    // row's own height only fit the image, and the
                    // caption overflowed below it.
                    captionAllowance: AppDimens.sdp(context, '_28sdp'),
                    itemBuilder: (context, index, tileWidth, tileHeight) {
                      final sample = samples[index];
                      return SelectableThumbnailTile(
                        icon: Icons.directions_walk_rounded,
                        imageUrl: sample.thumbnailUrl,
                        // This is an admin-generated animated GIF (see
                        // SlowGifImage's doc comment), not a static photo
                        // — plays it back at a quarter of its own encoded
                        // speed instead of the ~0.3s blink-and-miss loop.
                        slowGif: true,
                        tint: AppColors.pinkGradientStart,
                        caption: sample.title,
                        width: tileWidth,
                        height: tileHeight,
                        radius: AppDimens.sdp(context, '_6sdp'),
                        selected: sample.id == selection.selectedSample?.id,
                        onTap: () => controller.selectSample(sample),
                      );
                    },
                    onMore: () async {
                      final picked = await showSingleThumbnailPickerSheet(
                        context,
                        title: AppStrings.motionPresetStep,
                        items: [
                          for (final sample in samples)
                            (
                              id: sample.id,
                              label: sample.title,
                              imageUrl: sample.thumbnailUrl,
                              tint: AppColors.pinkGradientStart,
                            ),
                        ],
                        selectedId: selection.selectedSample?.id,
                        slowGif: true,
                      );
                      if (picked == null) return;
                      final match = samples.firstWhere((s) => s.id == picked);
                      controller.selectSample(match);
                    },
                  );
                },
              ),
            ],
          ),
        ),
        SizedBox(height: sectionGap),
        BorderedCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const WizardStepHeader(number: 2, title: AppStrings.outputStep),
              SizedBox(height: sectionGap),
              Row(
                children: [
                  Expanded(
                    child: LabeledDropdownField(
                      label: AppStrings.durationLabel,
                      value: '${selection.duration} Seconds',
                      // Editable even with a preset selected — sending
                      // sampleVideoId together with a chosen duration is the
                      // API's supported "preset with override" request shape.
                      onTap: () async {
                        final result = await pickOptionSheet(
                          context,
                          title: AppStrings.durationLabel,
                          options: const [
                            '5 Seconds',
                            '10 Seconds',
                            '15 Seconds',
                          ],
                          selected: '${selection.duration} Seconds',
                        );
                        if (result != null) {
                          controller.setDuration(
                            int.parse(result.split(' ').first),
                          );
                        }
                      },
                    ),
                  ),
                  SizedBox(width: fieldGap),
                  Expanded(
                    child: LabeledDropdownField(
                      label: 'Quality',
                      value: selection.quality,
                      onTap: () async {
                        final priced =
                            sampleVideosAsync
                                .value
                                ?.pixverseVideoPricing
                                ?.qualityBase
                                .keys
                                .toList() ??
                            const <String>[];
                        // Empty when no tier's price could be read; the
                        // server still accepts every tier.
                        final qualities = priced.isNotEmpty
                            ? priced
                            : const ['360p', '540p', '720p', '1080p'];
                        final result = await pickOptionSheet(
                          context,
                          title: 'Quality',
                          options: qualities,
                          selected: selection.quality,
                        );
                        if (result != null) controller.setQuality(result);
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        SizedBox(height: sectionGap),
        if (_submitError != null) ...[
          InlineErrorBanner(message: _submitError!),
          SizedBox(height: sectionGap),
        ],
        GradientButton(
          label: '${AppStrings.generateVideo} ${AppStrings.creditsSuffix(10)}',
          isLoading: _isSubmitting,
          onPressed:
              (selection.sourceImageKey == null &&
                  selection.sourceJobId == null)
              ? null
              : _generate,
          icon: Icon(
            Icons.auto_awesome_rounded,
            color: Colors.white,
            size: AppDimens.sdp(context, '_18sdp'),
          ),
        ),
      ],
    );
  }
}

class _UploadImageSection extends StatelessWidget {
  const _UploadImageSection({
    required this.sourceFile,
    required this.hasSourceJob,
    required this.sourceThumbUrl,
    required this.uploading,
    required this.onBrowseImage,
    required this.onSelectCatalogue,
    required this.onClear,
  });

  final File? sourceFile;
  final bool hasSourceJob;

  /// Resolved result image for a source picked via "Select Catalogue" (no
  /// local [sourceFile] exists for that case) — null while it's still
  /// loading, in which case the generic checkmark below is shown instead.
  final String? sourceThumbUrl;
  final bool uploading;
  final VoidCallback onBrowseImage;
  final VoidCallback onSelectCatalogue;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final radiusValue = AppDimens.sdp(context, '_14sdp');
    final radius = BorderRadius.circular(radiusValue);
    final actionGap = AppDimens.sdp(context, '_10sdp');
    final hasSource = sourceFile != null || hasSourceJob;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DashedBorderContainer(
          borderRadius: radiusValue,
          child: Container(
            width: double.infinity,
            padding: EdgeInsets.symmetric(
              vertical: AppDimens.sdp(context, '_28sdp'),
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.03),
              borderRadius: radius,
            ),
            child: hasSource
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (sourceFile != null)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(context, '_8sdp'),
                          ),
                          child: Image.file(
                            sourceFile!,
                            width: AppDimens.sdp(context, '_72sdp'),
                            height: AppDimens.sdp(context, '_72sdp'),
                            fit: BoxFit.cover,
                          ),
                        )
                      else if (sourceThumbUrl != null)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(context, '_8sdp'),
                          ),
                          child: AppNetworkImage(
                            sourceThumbUrl!,
                            width: AppDimens.sdp(context, '_72sdp'),
                            height: AppDimens.sdp(context, '_72sdp'),
                            thumbnail: true,
                            errorBuilder: (_) => Icon(
                              Icons.check_circle_rounded,
                              color: AppColors.pinkGradientStart,
                              size: AppDimens.sdp(context, '_28sdp'),
                            ),
                          ),
                        )
                      else
                        Icon(
                          Icons.check_circle_rounded,
                          color: AppColors.pinkGradientStart,
                          size: AppDimens.sdp(context, '_28sdp'),
                        ),
                      SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                      Text(
                        uploading ? 'Uploading…' : 'Source ready',
                        style: AppTextStyles.semiBold.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(context, '_13ssp'),
                        ),
                      ),
                      TextButton(
                        onPressed: onClear,
                        child: const Text('Change'),
                      ),
                    ],
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.cloud_upload_outlined,
                        color: AppColors.textSecondary,
                        size: AppDimens.sdp(context, '_28sdp'),
                      ),
                      SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                      Text(
                        AppStrings.uploadImage,
                        style: AppTextStyles.semiBold.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(context, '_13ssp'),
                        ),
                      ),
                      SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                      Text(
                        AppStrings.uploadImageHint,
                        textAlign: TextAlign.center,
                        style: AppTextStyles.regular.copyWith(
                          color: AppColors.textSecondary,
                          fontSize: AppDimens.ssp(context, '_11ssp'),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_14sdp')),
        Row(
          children: [
            Expanded(
              child: AppPillButton(
                label: AppStrings.selectCatalogue,
                icon: Icons.folder_outlined,
                style: AppPillButtonStyle.tonal,
                onTap: onSelectCatalogue,
              ),
            ),
            SizedBox(width: actionGap),
            Expanded(
              child: AppPillButton(
                label: AppStrings.browseImage,
                icon: Icons.image_outlined,
                style: AppPillButtonStyle.tonal,
                onTap: onBrowseImage,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// "Browse Catalogues" picker — mirrors the web app's CataloguePickerModal:
/// a paginated grid of individual completed job images (10 at a time, same
/// as web's own page size), each resolving its own thumbnail lazily via
/// [jobThumbnailUrlProvider] rather than fetching every one up front. Web's
/// own comment on this explains why the cap matters: an unbounded gallery
/// firing one thumbnail request per job can exceed the API's per-IP rate
/// limit on a long-history account (docs/progress.md, "catalog-video
/// rate-limit incident").
class _CataloguePickerSheet extends StatefulWidget {
  const _CataloguePickerSheet({required this.jobIds});

  final List<String> jobIds;

  @override
  State<_CataloguePickerSheet> createState() => _CataloguePickerSheetState();
}

class _CataloguePickerSheetState extends State<_CataloguePickerSheet> {
  static const _pageSize = 10;
  int _visibleCount = _pageSize;

  @override
  Widget build(BuildContext context) {
    final visible = widget.jobIds.take(_visibleCount).toList();
    final hasMore = _visibleCount < widget.jobIds.length;
    final maxHeight = MediaQuery.sizeOf(context).height * 0.8;

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppDimens.sdp(context, '_20sdp'),
                AppDimens.sdp(context, '_20sdp'),
                AppDimens.sdp(context, '_20sdp'),
                AppDimens.sdp(context, '_8sdp'),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      AppStrings.selectCatalogue,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_15ssp'),
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
                        size: AppDimens.sdp(context, '_18sdp'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                  AppDimens.sdp(context, '_20sdp'),
                  0,
                  AppDimens.sdp(context, '_20sdp'),
                  AppDimens.sdp(context, '_8sdp'),
                ),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    const crossAxisCount = 3;
                    final spacing = AppDimens.sdp(context, '_10sdp');
                    final cellWidth =
                        (constraints.maxWidth -
                            spacing * (crossAxisCount - 1)) /
                        crossAxisCount;
                    // 3:4, same as web's own picker tiles.
                    final cellHeight = cellWidth / (3 / 4);
                    return Column(
                      children: [
                        Wrap(
                          spacing: spacing,
                          runSpacing: spacing,
                          children: [
                            for (final jobId in visible)
                              _JobThumbnailTile(
                                jobId: jobId,
                                width: cellWidth,
                                height: cellHeight,
                                onTap: () => Navigator.of(context).pop(jobId),
                              ),
                          ],
                        ),
                        if (hasMore)
                          Padding(
                            padding: EdgeInsets.only(
                              top: AppDimens.sdp(context, '_16sdp'),
                            ),
                            child: TextButton(
                              onPressed: () =>
                                  setState(() => _visibleCount += _pageSize),
                              child: Text(
                                'Load more',
                                style: AppTextStyles.semiBold.copyWith(
                                  color: AppColors.textSecondary,
                                  fontSize: AppDimens.ssp(context, '_13ssp'),
                                ),
                              ),
                            ),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _JobThumbnailTile extends ConsumerWidget {
  const _JobThumbnailTile({
    required this.jobId,
    required this.width,
    required this.height,
    required this.onTap,
  });

  final String jobId;
  final double width;
  final double height;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final thumbAsync = ref.watch(jobThumbnailUrlProvider(jobId));
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_8sdp'));

    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: radius,
        child: Container(
          width: width,
          height: height,
          color: AppColors.fieldFill,
          alignment: Alignment.center,
          child: thumbAsync.when(
            data: (url) => AppNetworkImage(
              url,
              width: width,
              height: height,
              thumbnail: true,
              errorBuilder: (_) => Icon(
                Icons.image_not_supported_rounded,
                color: AppColors.textSecondary,
              ),
            ),
            loading: () => const AppLoader.small(),
            error: (_, _) => Icon(
              Icons.image_not_supported_rounded,
              color: AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}

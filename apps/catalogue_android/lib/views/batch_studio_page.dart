import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/studio/application/batch_selection_controller.dart';
import '../features/studio/application/batch_validation.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/garment_type.dart';
import '../features/studio/data/models/gender.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';
import 'batch_configure_page.dart';
import 'batch_widgets.dart';

const _platformOptions = ['Amazon', 'Flipkart', 'Myntra', 'Shopify', 'Instagram'];

/// Batch Studio, step one: who the catalogue is for, which garment type, the
/// garment photos (one row is created per photo) and the output settings.
/// "Configure" then opens [BatchConfigurePage] to pick each row's look.
///
/// Mirrors the web app's Batch mode (`studio/batch/*`); the same
/// `POST /v1/jobs/batch` sits behind it.
class BatchStudioPage extends ConsumerStatefulWidget {
  const BatchStudioPage({super.key});

  @override
  ConsumerState<BatchStudioPage> createState() => _BatchStudioPageState();
}

class _BatchStudioPageState extends ConsumerState<BatchStudioPage> {
  final _picker = ImagePicker();

  Future<void> _selectGender(Gender gender) async {
    final state = ref.read(batchSelectionControllerProvider);
    if (gender == state.gender) return;
    if (state.hasWork) {
      final ok = await confirmBatchDialog(
        context,
        title: AppStrings.batchClearRowsTitle,
        body: AppStrings.batchChangeAudienceBody,
        action: AppStrings.batchClearRowsAction,
      );
      if (!ok || !mounted) return;
    }
    ref.read(batchSelectionControllerProvider.notifier).selectGender(gender);
  }

  Future<void> _selectGarmentType(GarmentType type) async {
    final state = ref.read(batchSelectionControllerProvider);
    if (type.id == state.garmentType?.id) return;
    if (state.hasWork) {
      final ok = await confirmBatchDialog(
        context,
        title: AppStrings.batchClearRowsTitle,
        body: AppStrings.batchClearRowsBody,
        action: AppStrings.batchClearRowsAction,
      );
      if (!ok || !mounted) return;
    }
    ref.read(batchSelectionControllerProvider.notifier).selectGarmentType(type);
  }

  Future<void> _pickGarments() async {
    final picked = await _picker.pickMultiImage();
    if (picked.isEmpty || !mounted) return;
    // Not awaited: the tray shows each photo's own progress as it uploads.
    ref
        .read(batchSelectionControllerProvider.notifier)
        .addGarments([for (final p in picked) File(p.path)]);
  }

  Future<void> _pick({
    required String title,
    required List<String> options,
    required String selected,
    required ValueChanged<String> onSelected,
  }) async {
    final result = await pickOptionSheet(
      context,
      title: title,
      options: options,
      selected: selected,
    );
    if (result != null) onSelected(result);
  }

  void _configure() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const BatchConfigurePage()));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(batchSelectionControllerProvider);
    final controller = ref.read(batchSelectionControllerProvider.notifier);
    final garmentType = state.garmentType;
    final photos = state.garmentRows;

    final sectionGap = AppDimens.sdp(context, '_18sdp');
    final fieldGap = AppDimens.sdp(context, '_12sdp');

    // Leaving with photos uploaded or choices made would silently lose them.
    return PopScope(
      canPop: !state.hasWork,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final ok = await confirmBatchDialog(
          context,
          title: AppStrings.batchDiscardTitle,
          body: AppStrings.batchDiscardBody,
          action: AppStrings.batchDiscardAction,
        );
        if (ok && context.mounted) Navigator.of(context).pop();
      },
      child: DetailPageScaffold(
        title: AppStrings.batchStudioTitle,
        subtitle: AppStrings.batchStudioSubtitle,
        // Backed by a solid plate: the bar floats over scrolling content, and
        // a disabled (dimmed) button alone lets that content show through it.
        bottomBar: DecoratedBox(
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
          ),
          child: GradientButton(
            label: AppStrings.batchConfigureButton(photos.length),
            onPressed: garmentType != null && photos.isNotEmpty
                ? _configure
                : null,
          ),
        ),
        children: [
          _StepCard(
            number: 1,
            title: AppStrings.batchAudienceTitle,
            subtitle: AppStrings.batchAudienceSubtitle,
            child: BatchAdaptiveGrid(
              columnsFor: (w) => w >= 480 ? 4 : 2,
              spacing: AppDimens.sdp(context, '_10sdp'),
              children: [
                for (final g in Gender.values)
                  Consumer(
                    builder: (context, ref, _) {
                      final faces = ref.watch(facesProvider(g)).value;
                      return BatchAudienceTile(
                        label: g.displayLabel,
                        avatarUrl: faces?.firstOrNull?.thumbnailUrl,
                        selected: g == state.gender,
                        onTap: () => _selectGender(g),
                      );
                    },
                  ),
              ],
            ),
          ),
          SizedBox(height: sectionGap),
          _StepCard(
            number: 2,
            title: AppStrings.batchGarmentTypeTitle,
            subtitle: AppStrings.batchGarmentTypeSubtitle,
            child: _GarmentTypeGrid(
              gender: state.gender,
              selectedId: garmentType?.id,
              onSelect: _selectGarmentType,
            ),
          ),
          if (garmentType != null) ...[
            SizedBox(height: sectionGap),
            _StepCard(
              number: 3,
              title: AppStrings.batchUploadTitle,
              subtitle: AppStrings.batchUploadSubtitle,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _UploadDropZone(
                    compact: photos.isNotEmpty,
                    onTap: _pickGarments,
                  ),
                  if (photos.isNotEmpty) ...[
                    SizedBox(height: fieldGap),
                    BatchAdaptiveGrid(
                      columnsFor: (w) => w >= 560 ? 5 : (w >= 380 ? 3 : 2),
                      spacing: AppDimens.sdp(context, '_10sdp'),
                      children: [
                        for (final row in photos)
                          AspectRatio(
                            key: ValueKey(row.id),
                            aspectRatio: 1,
                            child: BatchGarmentPhoto(
                              path: row.localImagePath!,
                              uploading: row.isUploadingGarment,
                              error: row.garmentError,
                              onRemove: () => controller.removeRow(row.id),
                              onRetry: () => controller.retryGarment(row.id),
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            SizedBox(height: sectionGap),
            _StepCard(
              number: 4,
              title: AppStrings.batchOutputTitle,
              child: Row(
                children: [
                  Expanded(
                    child: LabeledDropdownField(
                      label: AppStrings.platformLabel,
                      value: state.platform,
                      onTap: () => _pick(
                        title: AppStrings.platformLabel,
                        options: _platformOptions,
                        selected: state.platform,
                        onSelected: controller.selectPlatform,
                      ),
                    ),
                  ),
                  SizedBox(width: fieldGap),
                  Expanded(
                    child: LabeledDropdownField(
                      label: AppStrings.aspectRatioLabel,
                      value: state.aspectRatio,
                      onTap: () => _pick(
                        title: AppStrings.aspectRatioLabel,
                        options: kBatchAspectRatios,
                        selected: state.aspectRatio,
                        onSelected: controller.selectAspectRatio,
                      ),
                    ),
                  ),
                  SizedBox(width: fieldGap),
                  Expanded(
                    child: Consumer(
                      builder: (context, ref, _) {
                        final config = ref
                            .watch(resolutionsConfigProvider)
                            .value;
                        final enabled =
                            config?.resolutions.entries
                                .where((e) => e.value.enabled)
                                .toList() ??
                            const [];
                        return LabeledDropdownField(
                          label: AppStrings.resolutionLabel,
                          value: state.resolution,
                          onTap: () {
                            if (enabled.isEmpty) return;
                            _pick(
                              title: AppStrings.resolutionLabel,
                              options: [
                                for (final e in enabled)
                                  '${e.key} (${e.value.creditCost} Credits)',
                              ],
                              selected: state.resolution,
                              onSelected: (v) => controller.selectResolution(
                                v.split(' ').first,
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A numbered card holding one step of the flow.
class _StepCard extends StatelessWidget {
  const _StepCard({
    required this.number,
    required this.title,
    required this.child,
    this.subtitle,
  });

  final int number;
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return BorderedCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          WizardStepHeader(number: number, title: title),
          if (subtitle != null) ...[
            SizedBox(height: AppDimens.sdp(context, '_4sdp')),
            Padding(
              padding: EdgeInsets.only(left: AppDimens.sdp(context, '_32sdp')),
              child: Text(
                subtitle!,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_11ssp'),
                ),
              ),
            ),
          ],
          SizedBox(height: AppDimens.sdp(context, '_14sdp')),
          child,
        ],
      ),
    );
  }
}

class _GarmentTypeGrid extends ConsumerWidget {
  const _GarmentTypeGrid({
    required this.gender,
    required this.selectedId,
    required this.onSelect,
  });

  final Gender gender;
  final String? selectedId;
  final ValueChanged<GarmentType> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final typesAsync = ref.watch(garmentTypesProvider(gender));

    return typesAsync.when(
      loading: () => const AppLoader.section(),
      error: (_, _) =>
          const InlineErrorBanner(message: 'Could not load garment types.'),
      data: (all) {
        // Batch can't run the mannequin two-pass flow (each garment's second
        // step is unplannable until its mannequin render finishes) and has no
        // third-piece upload, so those types aren't offered.
        final types = [
          for (final t in all)
            if (!t.requiresMannequinStep && !t.requiresThirdUpload) t,
        ];
        if (types.isEmpty) {
          return Text(
            'No garment types are available for batch here yet.',
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_12ssp'),
            ),
          );
        }
        return BatchAdaptiveGrid(
          columnsFor: (w) => w >= 700 ? 5 : (w >= 480 ? 4 : 2),
          spacing: AppDimens.sdp(context, '_10sdp'),
          children: [
            for (final t in types)
              BatchGarmentTypeCard(
                key: ValueKey(t.id),
                label: t.label,
                imageUrl: t.thumbnailUrl,
                selected: t.id == selectedId,
                onTap: () => onSelect(t),
              ),
          ],
        );
      },
    );
  }
}

/// The multi-select upload target: large and instructive while empty, a slim
/// "add more" strip once photos exist so the thumbnails get the room.
class _UploadDropZone extends StatelessWidget {
  const _UploadDropZone({required this.compact, required this.onTap});

  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final iconBox = AppDimens.sdp(context, compact ? '_32sdp' : '_46sdp');

    final icon = Container(
      width: iconBox,
      height: iconBox,
      decoration: BoxDecoration(
        color: AppColors.pinkGradientStart.withValues(alpha: 0.14),
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.cloud_upload_outlined,
        color: AppColors.pinkGradientStart,
        size: iconBox * 0.5,
      ),
    );

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: DashedBorderContainer(
        borderRadius: AppDimens.sdp(context, '_14sdp'),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_16sdp'),
            vertical: AppDimens.sdp(context, compact ? '_14sdp' : '_28sdp'),
          ),
          child: compact
              ? Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    icon,
                    SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                    Flexible(
                      child: Text(
                        AppStrings.batchUploadMore,
                        style: AppTextStyles.semiBold.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(context, '_13ssp'),
                        ),
                      ),
                    ),
                  ],
                )
              : Column(
                  children: [
                    icon,
                    SizedBox(height: AppDimens.sdp(context, '_10sdp')),
                    Text(
                      AppStrings.batchUploadEmptyTitle,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_14ssp'),
                      ),
                    ),
                    SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                    Text(
                      AppStrings.batchUploadEmptyHint,
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
    );
  }
}

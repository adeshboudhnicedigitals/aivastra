import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../features/studio/application/batch_selection_controller.dart';
import '../features/studio/application/batch_selection_state.dart';
import '../features/studio/application/batch_validation.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalog_node.dart';
import '../features/studio/data/models/garment_type.dart';
import '../features/studio/data/models/pose_model.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';
import '../utils/app_strings.dart';
import 'batch_widgets.dart';
import 'my_creations_page.dart';

/// Everything a row's pickers choose from, resolved once per build.
class _BatchOptions {
  const _BatchOptions({
    required this.faces,
    required this.backgrounds,
    required this.poseThumbs,
    required this.poses,
    required this.lower,
    required this.shoes,
  });

  final List<PickableThumb> faces;
  final List<PickableThumb> backgrounds;
  final List<PickableThumb> poseThumbs;
  final List<PoseModel> poses;
  final List<PickableThumb> lower;
  final List<PickableThumb> shoes;

  static PickableThumb? find(List<PickableThumb> items, String? id) {
    if (id == null) return null;
    for (final item in items) {
      if (item.id == id) return item;
    }
    return null;
  }
}

Iterable<CatalogItem> _flattenNode(CatalogNode node) sync* {
  yield* node.items;
  for (final child in node.children) {
    yield* _flattenNode(child);
  }
}

List<PickableThumb> _catalogThumbs(CatalogTree? tree, Color tint) => [
  if (tree != null)
    for (final node in tree.tree)
      for (final item in _flattenNode(node))
        (
          id: item.id,
          label: item.label,
          imageUrl: item.thumbnailUrl,
          tint: tint,
        ),
];

/// Batch Studio, step two: one card per garment photo, each choosing its own
/// model, background and poses (plus lower garment / shoes when the chosen
/// poses call for them). The floating summary shows what the batch will
/// cost and submits it in a single `POST /v1/jobs/batch`.
class BatchConfigurePage extends ConsumerStatefulWidget {
  const BatchConfigurePage({super.key});

  @override
  ConsumerState<BatchConfigurePage> createState() => _BatchConfigurePageState();
}

class _BatchConfigurePageState extends ConsumerState<BatchConfigurePage> {
  Future<void> _submit(List<PoseModel> poses) async {
    final controller = ref.read(batchSelectionControllerProvider.notifier);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await controller.submit(poses: poses);
      if (!mounted) return;
      final failed = result.failedJobIds.length;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            failed == 0
                ? 'Batch started: ${result.totalJobs} images, '
                      '${result.creditsCharged} credits.'
                : 'Batch started, but $failed of ${result.totalJobs} images '
                      "couldn't be queued and were refunded.",
          ),
        ),
      );
      // Replaces the whole stack with the My Creations tab, which also
      // disposes the batch flow's state.
      pushMyCreationsPage(context);
    } on AppException {
      // The controller already put the message on state for the summary bar.
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(batchSelectionControllerProvider);
    final garmentType = state.garmentType;
    if (garmentType == null) return const SizedBox.shrink();

    final gender = state.gender;
    final posesAsync = ref.watch(
      posesProvider((gender: gender, garmentTypeId: garmentType.id)),
    );
    final facesAsync = ref.watch(facesProvider(gender));
    final backgroundsAsync = ref.watch(backgroundsProvider(gender));

    final poses = posesAsync.value ?? const <PoseModel>[];
    // /v1/catalog/lower|shoe only takes the current (non-legacy) path when
    // poseIds is present, and a row's poses are per-row — so pass every pose
    // of this type, as the web app's batch mode does.
    final poseIdsKey = (poses.map((p) => p.id).toList()..sort()).join(',');
    final lowerTree = poses.isEmpty
        ? null
        : ref
              .watch(
                lowerCatalogProvider((
                  gender: gender,
                  garmentTypeId: garmentType.id,
                  poseIdsKey: poseIdsKey,
                )),
              )
              .value;
    final shoeTree = poses.isEmpty
        ? null
        : ref
              .watch(
                shoeCatalogProvider((
                  gender: gender,
                  garmentTypeId: garmentType.id,
                  poseIdsKey: poseIdsKey,
                )),
              )
              .value;

    final options = _BatchOptions(
      faces: [
        for (final f in facesAsync.value ?? const [])
          (
            id: f.id,
            label: f.label,
            imageUrl: f.thumbnailUrl,
            tint: AppColors.pinkGradientStart,
          ),
      ],
      backgrounds: [
        for (final b in backgroundsAsync.value ?? const [])
          (
            id: b.id,
            label: b.label,
            imageUrl: b.thumbnailUrl,
            tint: AppColors.pinkGradientStart,
          ),
      ],
      poseThumbs: [
        for (final p in poses)
          (
            id: p.id,
            label: p.label,
            imageUrl: p.thumbnailUrl,
            tint: AppColors.infoBlue,
          ),
      ],
      poses: poses,
      lower: _catalogThumbs(lowerTree, AppColors.violet),
      shoes: _catalogThumbs(shoeTree, AppColors.violet),
    );

    final invalidIds = {
      for (final r in invalidBatchRows(
        state.rows,
        garmentType: garmentType,
        poses: poses,
      ))
        r.id,
    };
    final totalJobs = countBatchJobs(state.rows);

    final loading =
        posesAsync.isLoading ||
        facesAsync.isLoading ||
        backgroundsAsync.isLoading;
    final loadFailed =
        posesAsync.hasError || facesAsync.hasError || backgroundsAsync.hasError;

    final gap = AppDimens.sdp(context, '_14sdp');

    return DetailPageScaffold(
      title: AppStrings.batchConfigureTitle,
      subtitle: AppStrings.batchConfigureSubtitle,
      bottomBar: _SummaryBar(
        rowCount: state.rows.length,
        totalJobs: totalJobs,
        invalidRowCount: invalidIds.length,
        posesReady: poses.isNotEmpty,
        resolution: state.resolution,
        submitting: state.isSubmitting,
        errorMessage: state.errorMessage,
        onSubmit: () => _submit(poses),
      ),
      children: [
        if (loading && poses.isEmpty)
          const AppLoader.section()
        else if (loadFailed && poses.isEmpty)
          const InlineErrorBanner(
            message: 'Could not load models, backgrounds and poses.',
          )
        else ...[
          if (state.rows.length > 1) ...[
            _ApplyToAll(options: options),
            SizedBox(height: gap),
          ],
          for (var i = 0; i < state.rows.length; i++) ...[
            _BatchRowCard(
              key: ValueKey(state.rows[i].id),
              index: i,
              row: state.rows[i],
              garmentType: garmentType,
              options: options,
              missing: batchRowIssues(
                state.rows[i],
                garmentType: garmentType,
                poses: poses,
              ),
              rejected: state.rejectedRowId == state.rows[i].id,
            ),
            SizedBox(height: gap),
          ],
          Align(
            alignment: Alignment.centerLeft,
            child: AppPillButton(
              label: AppStrings.batchAddRow,
              icon: Icons.add_rounded,
              style: AppPillButtonStyle.tonal,
              onTap: state.rows.length >= kMaxBatchRows
                  ? () {}
                  : ref.read(batchSelectionControllerProvider.notifier).addRow,
            ),
          ),
        ],
        // The floating summary is taller than the scaffold's default reserve.
        SizedBox(height: AppDimens.sdp(context, '_80sdp')),
      ],
    );
  }
}

/// "Apply to all rows": set one field on every row at once.
class _ApplyToAll extends ConsumerWidget {
  const _ApplyToAll({required this.options});

  final _BatchOptions options;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(batchSelectionControllerProvider.notifier);

    Future<void> single(
      String title,
      List<PickableThumb> items,
      void Function(String id) apply,
    ) async {
      final id = await showSingleThumbnailPickerSheet(
        context,
        title: title,
        items: items,
        selectedId: null,
        showLabels: false,
      );
      if (id != null) apply(id);
    }

    return BorderedCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.people_alt_outlined,
                color: Colors.white,
                size: AppDimens.sdp(context, '_16sdp'),
              ),
              SizedBox(width: AppDimens.sdp(context, '_8sdp')),
              Text(
                '${AppStrings.batchApplyToAll}:',
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_10sdp')),
          Wrap(
            spacing: AppDimens.sdp(context, '_8sdp'),
            runSpacing: AppDimens.sdp(context, '_8sdp'),
            children: [
              AppPillButton(
                label: 'Model',
                style: AppPillButtonStyle.tonal,
                onTap: () => single(
                  'Apply model to all rows',
                  options.faces,
                  controller.applyFaceToAll,
                ),
              ),
              AppPillButton(
                label: 'Background',
                style: AppPillButtonStyle.tonal,
                onTap: () => single(
                  'Apply background to all rows',
                  options.backgrounds,
                  controller.applyBackgroundToAll,
                ),
              ),
              AppPillButton(
                label: 'Poses',
                style: AppPillButtonStyle.tonal,
                onTap: () async {
                  final picked = await showMultiThumbnailPickerSheet(
                    context,
                    title: 'Apply poses to all rows',
                    items: options.poseThumbs,
                    selectedIds: const {},
                  );
                  if (picked != null && picked.isNotEmpty) {
                    controller.applyPosesToAll(picked, options.poses);
                  }
                },
              ),
              AppPillButton(
                label: 'Lower',
                style: AppPillButtonStyle.tonal,
                onTap: () => single(
                  'Apply lower garment to all rows',
                  options.lower,
                  controller.applyLowerToAll,
                ),
              ),
              AppPillButton(
                label: 'Shoes',
                style: AppPillButtonStyle.tonal,
                onTap: () => single(
                  'Apply shoes to all rows',
                  options.shoes,
                  controller.applyShoeToAll,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One look: its garment photo and the choices that make it complete.
class _BatchRowCard extends ConsumerWidget {
  const _BatchRowCard({
    super.key,
    required this.index,
    required this.row,
    required this.garmentType,
    required this.options,
    required this.missing,
    required this.rejected,
  });

  final int index;
  final BatchRowState row;
  final GarmentType garmentType;
  final _BatchOptions options;
  final List<String> missing;
  final bool rejected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(batchSelectionControllerProvider.notifier);
    final picker = ImagePicker();

    final selectedPoses = [
      for (final p in options.poses)
        if (row.poseIds.contains(p.id)) p,
    ];
    final needs = requiredInputsForPoses(selectedPoses);
    final face = _BatchOptions.find(options.faces, row.faceId);
    final background = _BatchOptions.find(
      options.backgrounds,
      row.backgroundId,
    );
    final lower = _BatchOptions.find(options.lower, row.lowerCatalogItemId);
    final shoe = _BatchOptions.find(options.shoes, row.shoeCatalogItemId);

    Future<File?> pickFile() async {
      final picked = await picker.pickImage(source: ImageSource.gallery);
      return picked == null ? null : File(picked.path);
    }

    Future<void> choose(
      String title,
      List<PickableThumb> items,
      String? selectedId,
      void Function(String id) apply,
    ) async {
      final id = await showSingleThumbnailPickerSheet(
        context,
        title: title,
        items: items,
        selectedId: selectedId,
        showLabels: false,
      );
      if (id != null) apply(id);
    }

    final cells = <Widget>[
      _Cell(
        label: 'Garment',
        child: row.localImagePath == null
            ? _EmptyCell(
                text: 'Upload',
                dashed: true,
                onTap: () async {
                  final file = await pickFile();
                  if (file != null) {
                    await controller.pickAndUploadRowGarment(row.id, file);
                  }
                },
              )
            : BatchGarmentPhoto(
                path: row.localImagePath!,
                uploading: row.isUploadingGarment,
                error: row.garmentError,
                onRemove: () => controller.removeRowGarment(row.id),
                onRetry: () => controller.retryGarment(row.id),
                onTap: () async {
                  final file = await pickFile();
                  if (file != null) {
                    await controller.pickAndUploadRowGarment(row.id, file);
                  }
                },
              ),
      ),
      if (garmentType.requiresLowerUpload)
        _Cell(
          label: garmentType.lowerUploadLabel ?? 'Bottom wear',
          child: row.localLowerImagePath == null
              ? _EmptyCell(
                  text: 'Upload',
                  dashed: true,
                  onTap: () async {
                    final file = await pickFile();
                    if (file != null) {
                      await controller.pickAndUploadRowLowerGarment(
                        row.id,
                        file,
                      );
                    }
                  },
                )
              : BatchGarmentPhoto(
                  path: row.localLowerImagePath!,
                  uploading: row.isUploadingLowerGarment,
                  error: row.lowerGarmentError,
                  onRemove: () => controller.removeRowLowerGarment(row.id),
                  onRetry: () async {
                    final path = row.localLowerImagePath;
                    if (path != null) {
                      await controller.pickAndUploadRowLowerGarment(
                        row.id,
                        File(path),
                      );
                    }
                  },
                  onTap: () async {
                    final file = await pickFile();
                    if (file != null) {
                      await controller.pickAndUploadRowLowerGarment(
                        row.id,
                        file,
                      );
                    }
                  },
                ),
        ),
      _Cell(
        label: 'Model',
        child: face == null
            ? _EmptyCell(
                text: 'Choose',
                onTap: () => choose(
                  'Choose model',
                  options.faces,
                  row.faceId,
                  (id) => controller.selectRowFace(row.id, id),
                ),
              )
            : _PickedCell(
                imageUrl: face.imageUrl,
                onTap: () => choose(
                  'Choose model',
                  options.faces,
                  row.faceId,
                  (id) => controller.selectRowFace(row.id, id),
                ),
              ),
      ),
      _Cell(
        label: 'Background',
        child: background == null
            ? _EmptyCell(
                text: 'Choose',
                onTap: () => choose(
                  'Choose background',
                  options.backgrounds,
                  row.backgroundId,
                  (id) => controller.selectRowBackground(row.id, id),
                ),
              )
            : _PickedCell(
                imageUrl: background.imageUrl,
                onTap: () => choose(
                  'Choose background',
                  options.backgrounds,
                  row.backgroundId,
                  (id) => controller.selectRowBackground(row.id, id),
                ),
              ),
      ),
      _Cell(
        label: 'Poses',
        child: selectedPoses.isEmpty
            ? _EmptyCell(text: 'Choose', onTap: () => _pickPoses(context, ref))
            : _PoseStack(
                poses: selectedPoses,
                onTap: () => _pickPoses(context, ref),
              ),
      ),
      _Cell(
        label: 'Lower',
        child: !needs.needsLower
            ? const _EmptyCell(text: 'Not needed', disabled: true)
            : (lower == null
                  ? _EmptyCell(
                      text: 'Choose',
                      onTap: () => choose(
                        'Choose lower garment',
                        options.lower,
                        row.lowerCatalogItemId,
                        (id) =>
                            controller.selectRowLowerCatalogItem(row.id, id),
                      ),
                    )
                  : _PickedCell(
                      imageUrl: lower.imageUrl,
                      onTap: () => choose(
                        'Choose lower garment',
                        options.lower,
                        row.lowerCatalogItemId,
                        (id) =>
                            controller.selectRowLowerCatalogItem(row.id, id),
                      ),
                    )),
      ),
      _Cell(
        label: 'Shoes',
        child: !needs.needsShoes
            ? const _EmptyCell(text: 'Not needed', disabled: true)
            : (shoe == null
                  ? _EmptyCell(
                      text: 'Choose',
                      onTap: () => choose(
                        'Choose shoes',
                        options.shoes,
                        row.shoeCatalogItemId,
                        (id) => controller.selectRowShoeCatalogItem(row.id, id),
                      ),
                    )
                  : _PickedCell(
                      imageUrl: shoe.imageUrl,
                      onTap: () => choose(
                        'Choose shoes',
                        options.shoes,
                        row.shoeCatalogItemId,
                        (id) => controller.selectRowShoeCatalogItem(row.id, id),
                      ),
                    )),
      ),
    ];

    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_18sdp')),
        border: Border.all(
          color: rejected ? AppColors.danger : AppColors.fieldBorder,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Row ${index + 1}',
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
              const Spacer(),
              _RowAction(
                icon: Icons.copy_rounded,
                tooltip: 'Duplicate row',
                onTap: () => controller.duplicateRow(row.id),
              ),
              SizedBox(width: AppDimens.sdp(context, '_6sdp')),
              _RowAction(
                icon: Icons.delete_outline_rounded,
                tooltip: 'Remove row',
                onTap: () => controller.removeRow(row.id),
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_10sdp')),
          BatchAdaptiveGrid(
            // 3 across on a phone; every cell in one line once there's room.
            columnsFor: (w) => w >= 520 ? cells.length : 3,
            spacing: AppDimens.sdp(context, '_10sdp'),
            children: cells,
          ),
          if (missing.isNotEmpty) ...[
            SizedBox(height: AppDimens.sdp(context, '_10sdp')),
            Text(
              'Missing: ${missing.join(', ')}',
              style: AppTextStyles.regular.copyWith(
                color: rejected ? AppColors.danger : AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_11ssp'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _pickPoses(BuildContext context, WidgetRef ref) async {
    final picked = await showMultiThumbnailPickerSheet(
      context,
      title: 'Choose poses',
      items: options.poseThumbs,
      selectedIds: row.poseIds,
    );
    if (picked == null) return;
    ref
        .read(batchSelectionControllerProvider.notifier)
        .setRowPoses(row.id, picked, options.poses);
  }
}

class _RowAction extends StatelessWidget {
  const _RowAction({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Padding(
          padding: EdgeInsets.all(AppDimens.sdp(context, '_6sdp')),
          child: Icon(
            icon,
            color: AppColors.textSecondary,
            size: AppDimens.sdp(context, '_18sdp'),
          ),
        ),
      ),
    );
  }
}

/// A square cell with its name underneath.
class _Cell extends StatelessWidget {
  const _Cell({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AspectRatio(aspectRatio: 1, child: child),
        SizedBox(height: AppDimens.sdp(context, '_4sdp')),
        Text(
          label,
          maxLines: 1,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: AppTextStyles.regular.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_10ssp'),
          ),
        ),
      ],
    );
  }
}

/// A cell with nothing chosen yet (or one that doesn't apply).
class _EmptyCell extends StatelessWidget {
  const _EmptyCell({
    required this.text,
    this.onTap,
    this.dashed = false,
    this.disabled = false,
  });

  final String text;
  final VoidCallback? onTap;
  final bool dashed;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final radius = AppDimens.sdp(context, '_10sdp');
    final content = Container(
      decoration: BoxDecoration(
        color: disabled
            ? Colors.white.withValues(alpha: 0.03)
            : AppColors.fieldFill,
        borderRadius: BorderRadius.circular(radius),
        border: dashed ? null : Border.all(color: AppColors.fieldBorder),
      ),
      alignment: Alignment.center,
      padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!disabled)
            Icon(
              dashed ? Icons.cloud_upload_outlined : Icons.add_rounded,
              color: AppColors.textSecondary,
              size: AppDimens.sdp(context, '_18sdp'),
            ),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppTextStyles.medium.copyWith(
              color: disabled
                  ? AppColors.textSecondary.withValues(alpha: 0.6)
                  : AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_10ssp'),
            ),
          ),
        ],
      ),
    );

    return GestureDetector(
      onTap: disabled ? null : onTap,
      behavior: HitTestBehavior.opaque,
      child: dashed
          ? DashedBorderContainer(borderRadius: radius, child: content)
          : content,
    );
  }
}

/// A cell showing the photo of what was chosen; tap to change it.
class _PickedCell extends StatelessWidget {
  const _PickedCell({required this.imageUrl, required this.onTap});

  final String? imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_10sdp'));
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(color: AppColors.fieldBorder),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_9sdp')),
          child: BatchNetworkImage(url: imageUrl),
        ),
      ),
    );
  }
}

/// The chosen poses as a diagonally offset stack (later on top), at most
/// three photos, with a badge giving the total count.
class _PoseStack extends StatelessWidget {
  const _PoseStack({required this.poses, required this.onTap});

  final List<PoseModel> poses;
  final VoidCallback onTap;

  static const _maxShown = 3;

  @override
  Widget build(BuildContext context) {
    final shown = poses.take(_maxShown).toList();
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_8sdp'));

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final side = constraints.maxWidth;
          final tile = side * 0.7;
          final step = shown.length > 1
              ? (side - tile) / (shown.length - 1)
              : 0.0;
          return Stack(
            clipBehavior: Clip.none,
            children: [
              for (var i = 0; i < shown.length; i++)
                Positioned(
                  left: i * step,
                  top: i * step,
                  width: tile,
                  height: tile,
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: radius,
                      border: Border.all(color: AppColors.fieldBorder),
                      boxShadow: const [
                        BoxShadow(color: Colors.black38, blurRadius: 4),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(
                        AppDimens.sdp(context, '_7sdp'),
                      ),
                      child: BatchNetworkImage(
                        url: shown[i].thumbnailUrl,
                        cacheWidth: 240,
                      ),
                    ),
                  ),
                ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: AppDimens.sdp(context, '_6sdp'),
                    vertical: AppDimens.sdp(context, '_2sdp'),
                  ),
                  decoration: BoxDecoration(
                    gradient: AppColors.pinkGradient,
                    borderRadius: BorderRadius.circular(
                      AppDimens.sdp(context, '_10sdp'),
                    ),
                  ),
                  child: Text(
                    '${poses.length}',
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_10ssp'),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Floating totals + the submit button.
class _SummaryBar extends ConsumerWidget {
  const _SummaryBar({
    required this.rowCount,
    required this.totalJobs,
    required this.invalidRowCount,
    required this.posesReady,
    required this.resolution,
    required this.submitting,
    required this.errorMessage,
    required this.onSubmit,
  });

  final int rowCount;
  final int totalJobs;
  final int invalidRowCount;
  final bool posesReady;
  final String resolution;
  final bool submitting;
  final String? errorMessage;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final credits = ref.watch(creditsSummaryProvider).value;
    final config = ref.watch(resolutionsConfigProvider).value;
    final costPerImage = config?.resolutions[resolution]?.creditCost;
    final creditCost = costPerImage == null ? null : totalJobs * costPerImage;

    final plan = credits?.unlimitedPlan;
    final planStatus = plan?['status'] as String?;
    final unlimited = planStatus == 'active' || planStatus == 'expiring_soon';
    final balance = credits?.balance;

    // One specific reason, in the order the user can act on it.
    final blocked = !posesReady
        ? 'Loading poses…'
        : invalidRowCount > 0
        ? '$invalidRowCount row${invalidRowCount == 1 ? '' : 's'} incomplete'
        : totalJobs == 0
        ? 'Add at least one pose'
        : totalJobs > kMaxBatchJobs
        ? 'Over the $kMaxBatchJobs-image limit'
        : (!unlimited &&
              balance != null &&
              creditCost != null &&
              balance < creditCost)
        ? 'Need $creditCost credits, you have $balance'
        : null;

    final summary = [
      '$rowCount row${rowCount == 1 ? '' : 's'}',
      '$totalJobs image${totalJobs == 1 ? '' : 's'}',
      if (creditCost != null) '$creditCost credits',
    ].join(' · ');

    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      decoration: BoxDecoration(
        color: AppColors.sheetBackground,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
        border: Border.all(color: AppColors.fieldBorder),
        boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 16)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            summary,
            style: AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_13ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_2sdp')),
          Text(
            unlimited
                ? 'Unlimited plan — no credits needed'
                : balance != null
                ? 'Balance $balance credits'
                : '',
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_11ssp'),
            ),
          ),
          if (errorMessage != null || blocked != null) ...[
            SizedBox(height: AppDimens.sdp(context, '_6sdp')),
            Text(
              errorMessage ?? blocked!,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.danger,
                fontSize: AppDimens.ssp(context, '_11ssp'),
              ),
            ),
          ],
          SizedBox(height: AppDimens.sdp(context, '_10sdp')),
          GradientButton(
            label: AppStrings.batchGenerateButton(totalJobs),
            isLoading: submitting,
            onPressed: blocked == null ? onSubmit : null,
            icon: Icon(
              Icons.auto_awesome_rounded,
              color: Colors.white,
              size: AppDimens.sdp(context, '_18sdp'),
            ),
          ),
        ],
      ),
    );
  }
}

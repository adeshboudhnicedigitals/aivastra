import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../core/providers/core_providers.dart';
import '../core/utils/list_ordering.dart';
import '../features/studio/application/catalogue_cost.dart';
import '../features/studio/application/catalogue_selection_controller.dart';
import '../features/studio/application/catalogue_selection_state.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalog_node.dart';
import '../features/studio/data/models/garment_type.dart';
import '../features/studio/data/models/gender.dart';
import '../features/studio/data/models/pose_preset.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/filter_sheet_widgets.dart';
import '../widgets/gradient_button.dart';
import '../widgets/spotlight_tutorial.dart';
import 'batch_studio_page.dart';
import 'catalogue_result_page.dart';

/// Matches the web app's own per-gender illustrations (studio/page.tsx's
/// GENDERS array) — gender has no API-driven photo, it's a fixed set of 4.
String _genderAvatarAsset(Gender gender) => switch (gender) {
  Gender.women => AppAssets.genderWomen,
  Gender.men => AppAssets.genderMen,
  Gender.boys => AppAssets.genderBoy,
  Gender.girls => AppAssets.genderGirl,
};

const _aspectRatioOptions = ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9'];
const _platformOptions = [
  'Amazon',
  'Flipkart',
  'Myntra',
  'Shopify',
  'Instagram',
];

class CatalogueStudioForm extends ConsumerStatefulWidget {
  const CatalogueStudioForm({super.key});

  @override
  ConsumerState<CatalogueStudioForm> createState() =>
      _CatalogueStudioFormState();
}

class _CatalogueStudioFormState extends ConsumerState<CatalogueStudioForm> {
  final _picker = ImagePicker();
  File? _upperFile;
  File? _lowerFile;
  File? _thirdFile;
  File? _palluFile;
  String? _submitError;
  bool _isSubmitting = false;
  int? _selectedBackgroundCategoryId;

  // First-open spotlight walkthrough targets — see _maybeShowTutorial.
  final _catalogueForKey = GlobalKey();
  final _garmentTypeKey = GlobalKey();
  final _uploadKey = GlobalKey();
  final _infoIconKey = GlobalKey();
  final _generateKey = GlobalKey();
  bool _tutorialScheduled = false;

  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame for the same reason the controller's
    // own async continuations are: mutating provider state as a side effect
    // of a widget's build/watch can corrupt Flutter's layout dirty-tracking.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(catalogueSelectionControllerProvider.notifier)
          .ensureDefaultGarmentType();
    });
  }

  /// Runs once, the first time a garment type is resolved (so the Upload box
  /// and Generate button below it actually exist to point at) — guarded by
  /// [_tutorialScheduled] against re-triggering on every rebuild, and by
  /// `studioTutorialSeen` against ever showing again after this install's
  /// first run.
  void _maybeShowTutorial() {
    if (ref.read(localPrefsProvider).studioTutorialSeen) return;
    showSpotlightTutorial(
      context,
      steps: [
        SpotlightStep(
          targetKey: _catalogueForKey,
          title: 'Choose who it\'s for',
          description:
              'Pick Women, Men, Boys or Girls — the catalogue images are '
              'generated for this audience.',
        ),
        SpotlightStep(
          targetKey: _garmentTypeKey,
          title: 'Pick your garment type',
          description:
              'Select the kind of clothing you\'re creating a catalogue '
              'for — this decides what you\'ll upload next.',
        ),
        SpotlightStep(
          targetKey: _uploadKey,
          title: 'Upload your garment photo',
          description:
              'Add a clear, well-lit photo of the garment. This is the one '
              'thing every catalogue needs.',
        ),
        SpotlightStep(
          targetKey: _infoIconKey,
          title: 'Not sure what to upload?',
          description:
              'Tap this info icon anytime for a reference photo and quick '
              'tips for this exact garment type.',
        ),
        SpotlightStep(
          targetKey: _generateKey,
          title: 'Generate your catalogue',
          description:
              'Once everything above is set, tap here to create your '
              'AI-generated catalogue photos.',
        ),
      ],
      onFinished: () => ref.read(localPrefsProvider).setStudioTutorialSeen(),
    );
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

  Future<void> _pickUpload(Future<void> Function(File) onPicked) async {
    final picked = await _picker.pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    await onPicked(File(picked.path));
  }

  void _resetGarmentTypeDependentState() {
    setState(() {
      _upperFile = null;
      _lowerFile = null;
      _thirdFile = null;
      _palluFile = null;
      _selectedBackgroundCategoryId = null;
    });
  }

  Future<void> _addBackground(CatalogueSelectionController controller) async {
    final choice = await pickOptionSheet(
      context,
      title: 'Add a background',
      options: const ['From Gallery', 'Paste Image URL'],
      selected: 'From Gallery',
    );
    if (choice == null) return;
    if (choice == 'From Gallery') {
      final picked = await _picker.pickImage(source: ImageSource.gallery);
      if (picked == null) return;
      await controller.uploadCustomBackground(File(picked.path));
      return;
    }
    final url = await _promptForText(
      title: 'Paste an image URL',
      hint: 'https://example.com/photo.jpg',
    );
    if (url == null || url.isEmpty) return;
    await controller.addCustomBackgroundFromUrl(url);
  }

  Future<String?> _promptForText({
    required String title,
    required String hint,
  }) {
    final textController = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: Text(title, style: const TextStyle(color: Colors.white)),
        content: TextField(
          controller: textController,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(textController.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteCustomBackground(
    CatalogueSelectionController controller,
    String id,
    String label,
  ) async {
    final confirmed = await _confirm(
      title: 'Remove "$label"?',
      body: 'This background will be deleted from your account.',
    );
    if (confirmed != true) return;
    await controller.deleteCustomBackground(id);
  }

  Future<void> _deletePosePreset(
    CatalogueSelectionController controller,
    Gender gender,
    String garmentTypeId,
    PosePreset preset,
  ) async {
    final confirmed = await _confirm(
      title: 'Delete "${preset.name}"?',
      body: 'This saved pose preset will be removed.',
    );
    if (confirmed != true) return;
    await controller.deletePosePreset(preset.id);
    ref.invalidate(
      posePresetsProvider((gender: gender, garmentTypeId: garmentTypeId)),
    );
  }

  Future<bool?> _confirm({required String title, required String body}) {
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: Text(title, style: const TextStyle(color: Colors.white)),
        content: Text(body, style: const TextStyle(color: Colors.white70)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  bool _canGenerate(
    CatalogueSelectionState selection,
    GarmentType? garmentType,
  ) {
    if (garmentType == null || selection.upperGarmentKey == null) {
      return false;
    }
    if (garmentType.sareeTwoInputCapable && selection.palluGarmentKey == null) {
      return false;
    }
    // Same rule submit() enforces, by mode: a template with at least one look
    // kept, or a background plus at least one pose.
    if (selection.lookMode == LookMode.readyMade) {
      return selection.selectedTemplate != null &&
          selection.selectedLookIds.isNotEmpty;
    }
    return selection.backgroundId != null && selection.poseIds.isNotEmpty;
  }

  Future<void> _generate() async {
    setState(() {
      _isSubmitting = true;
      _submitError = null;
    });
    final controller = ref.read(catalogueSelectionControllerProvider.notifier);
    try {
      final result = await controller.submit();
      if (!mounted) return;
      // The garment is now with the server; start the form fresh for next time.
      controller.clearUploads();
      setState(() {
        _upperFile = null;
        _lowerFile = null;
        _thirdFile = null;
        _palluFile = null;
      });
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CatalogueResultPage(
            catalogueId: result.catalogueId,
            gender: result.gender,
            garmentTypeId: result.garmentTypeId,
            poseIds: result.poseIds,
          ),
        ),
      );
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
    final tileGap = AppDimens.sdp(context, '_10sdp');
    // '_104sdp' isn't a key AppDimens defines (only _100/_106 nearby) and
    // silently resolved to 0, collapsing these thumbnail rows — _106sdp is
    // the closest defined value.
    final presetRowHeight = AppDimens.sdp(context, '_106sdp');
    final chipRowHeight = AppDimens.sdp(context, '_40sdp');

    final selection = ref.watch(catalogueSelectionControllerProvider);
    final controller = ref.read(catalogueSelectionControllerProvider.notifier);
    final garmentType = selection.garmentType;

    final garmentTypesAsync = ref.watch(garmentTypesProvider(selection.gender));

    if (garmentType != null && !_tutorialScheduled) {
      _tutorialScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _maybeShowTutorial();
      });
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        BorderedCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: WizardStepHeader(
                      number: 1,
                      title: AppStrings.setUpYourProductStep,
                    ),
                  ),
                  SizedBox(width: fieldGap),
                  // Batch is the many-garments-at-once flow (web's Single |
                  // Batch toggle) — it lives beside this step so it's found
                  // where the single flow begins without pushing it down.
                  AppPillButton(
                    label: AppStrings.batchButton,
                    icon: Icons.layers_rounded,
                    style: AppPillButtonStyle.filled,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const BatchStudioPage(),
                      ),
                    ),
                  ),
                ],
              ),
              SizedBox(height: sectionGap),
              Row(
                children: [
                  Expanded(
                    child: LabeledDropdownRow(
                      key: _catalogueForKey,
                      bordered: true,
                      iconBoxSize: AppDimens.sdp(context, '_44sdp'),
                      label: AppStrings.catalogueForLabel,
                      value: selection.gender.displayLabel,
                      icon: Icons.person_rounded,
                      tint: AppColors.pinkGradientStart,
                      image: Image.asset(
                        _genderAvatarAsset(selection.gender),
                        fit: BoxFit.cover,
                      ),
                      trailingIcon: Icons.keyboard_arrow_down_rounded,
                      onTap: () async {
                        // Same thumbnail-grid picker style as Garment Type,
                        // Model, Background, etc. — no photo per gender, so
                        // each tile falls back to its icon+tint placeholder.
                        final picked = await showSingleThumbnailPickerSheet(
                          context,
                          title: AppStrings.catalogueForLabel,
                          items: [
                            for (final g in Gender.values)
                              (
                                id: g.apiValue,
                                label: g.displayLabel,
                                imageUrl: _genderAvatarAsset(g),
                                tint: AppColors.pinkGradientStart,
                              ),
                          ],
                          selectedId: selection.gender.apiValue,
                        );
                        if (picked == null) return;
                        controller.selectGender(
                          Gender.values.firstWhere((g) => g.apiValue == picked),
                        );
                        _resetGarmentTypeDependentState();
                      },
                    ),
                  ),
                  SizedBox(width: fieldGap),
                  Expanded(
                    child: garmentTypesAsync.when(
                      loading: () => LabeledDropdownRow(
                        bordered: true,
                        iconBoxSize: AppDimens.sdp(context, '_44sdp'),
                        label: AppStrings.garmentTypeLabel,
                        value: 'Loading…',
                        icon: Icons.checkroom_rounded,
                        tint: AppColors.pinkGradientStart,
                        onTap: () {},
                      ),
                      error: (_, _) => LabeledDropdownRow(
                        bordered: true,
                        iconBoxSize: AppDimens.sdp(context, '_44sdp'),
                        label: AppStrings.garmentTypeLabel,
                        value: 'Unavailable',
                        icon: Icons.checkroom_rounded,
                        tint: AppColors.pinkGradientStart,
                        onTap: () {},
                      ),
                      data: (garmentTypes) {
                        return LabeledDropdownRow(
                          key: _garmentTypeKey,
                          bordered: true,
                          iconBoxSize: AppDimens.sdp(context, '_44sdp'),
                          label: AppStrings.garmentTypeLabel,
                          value: garmentType?.label ?? 'Select',
                          icon: Icons.checkroom_rounded,
                          tint: AppColors.pinkGradientStart,
                          image: garmentType?.thumbnailUrl == null
                              ? null
                              : AppNetworkImage(
                                  garmentType!.thumbnailUrl!,
                                  thumbnail: true,
                                  errorBuilder: (_) => Icon(
                                    Icons.checkroom_rounded,
                                    color: AppColors.pinkGradientStart,
                                    size: AppDimens.sdp(context, '_44sdp') * 0.5,
                                  ),
                                ),
                          onTap: () async {
                            // A real thumbnail grid instead of a plain text
                            // list — matches every other picker sheet in
                            // this form (Model, Background, Poses, Lower
                            // Garment, Footwear).
                            final picked = await showSingleThumbnailPickerSheet(
                              context,
                              title: AppStrings.garmentTypeLabel,
                              items: [
                                for (final g in garmentTypes)
                                  (
                                    id: g.id,
                                    label: g.label,
                                    imageUrl: g.thumbnailUrl,
                                    tint: AppColors.pinkGradientStart,
                                  ),
                              ],
                              selectedId: garmentType?.id,
                            );
                            if (picked == null) return;
                            final match = garmentTypes.firstWhere(
                              (g) => g.id == picked,
                            );
                            controller.selectGarmentType(match);
                            _resetGarmentTypeDependentState();
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
              if (garmentType != null) ...[
                SizedBox(height: sectionGap),
                // One shared "Upload Your Garment" headline regardless of
                // how many boxes follow — matches the Figma reference, where
                // each box instead carries its own short part name (Body,
                // Pallu, ...) inside itself. A single box still gets the
                // "thumb + Garment Uploaded" summary row once uploaded; two
                // or more share a row and each show their own photo full-size
                // with just a remove button, since repeating that summary
                // per box wouldn't fit.
                () {
                  final boxes = <
                    ({
                      String label,
                      File? file,
                      bool uploading,
                      bool uploaded,
                      VoidCallback onUpload,
                      VoidCallback onRemove,
                    })
                  >[
                    (
                      label: garmentType.sareeTwoInputCapable
                          ? 'Body'
                          : garmentType.upperUploadLabel ?? garmentType.label,
                      file: _upperFile,
                      uploading: selection.isUploadingUpper,
                      uploaded: selection.upperGarmentKey != null,
                      onUpload: () => _pickUpload((file) async {
                        setState(() => _upperFile = file);
                        await controller.pickAndUploadUpper(file);
                      }),
                      onRemove: () {
                        setState(() => _upperFile = null);
                        controller.removeUpperUpload();
                      },
                    ),
                    if (garmentType.sareeTwoInputCapable)
                      (
                        label: 'Pallu',
                        file: _palluFile,
                        uploading: selection.isUploadingPallu,
                        uploaded: selection.palluGarmentKey != null,
                        onUpload: () => _pickUpload((file) async {
                          setState(() => _palluFile = file);
                          await controller.pickAndUploadPallu(file);
                        }),
                        onRemove: () {
                          setState(() => _palluFile = null);
                          controller.removePalluUpload();
                        },
                      ),
                    if (garmentType.requiresLowerUpload)
                      (
                        label: garmentType.lowerUploadLabel ?? 'Bottom Wear',
                        file: _lowerFile,
                        uploading: selection.isUploadingLower,
                        uploaded: selection.lowerGarmentKey != null,
                        onUpload: () => _pickUpload((file) async {
                          setState(() => _lowerFile = file);
                          await controller.pickAndUploadLower(file);
                        }),
                        onRemove: () {
                          setState(() => _lowerFile = null);
                          controller.removeLowerUpload();
                        },
                      ),
                    if (garmentType.requiresThirdUpload)
                      (
                        label: garmentType.thirdUploadLabel ?? 'Extra Piece',
                        file: _thirdFile,
                        uploading: selection.isUploadingThird,
                        uploaded: selection.thirdGarmentKey != null,
                        onUpload: () => _pickUpload((file) async {
                          setState(() => _thirdFile = file);
                          await controller.pickAndUploadThird(file);
                        }),
                        onRemove: () {
                          setState(() => _thirdFile = null);
                          controller.removeThirdUpload();
                        },
                      ),
                  ];
                  final isMulti = boxes.length > 1;

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _labelWithInfoRow(
                        context,
                        AppStrings.uploadYourGarment,
                        style: _headlineStyle(context),
                        infoKey: _infoIconKey,
                        onInfoTap: () => showGarmentUploadTipsSheet(
                          context,
                          instructionImageUrl: garmentType.instructionImageUrl,
                        ),
                      ),
                      SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                      if (isMulti)
                        Row(
                          key: _uploadKey,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (var i = 0; i < boxes.length; i++) ...[
                              if (i > 0) SizedBox(width: fieldGap),
                              Expanded(
                                child: _UploadGarmentBox(
                                  label: boxes[i].label,
                                  file: boxes[i].file,
                                  uploading: boxes[i].uploading,
                                  uploaded: boxes[i].uploaded,
                                  tint: AppColors.pinkGradientStart,
                                  largeThumbnail: true,
                                  onUpload: boxes[i].onUpload,
                                  onRemove: boxes[i].onRemove,
                                ),
                              ),
                            ],
                          ],
                        )
                      else
                        _UploadGarmentBox(
                          key: _uploadKey,
                          label: boxes.single.label,
                          file: boxes.single.file,
                          uploading: boxes.single.uploading,
                          uploaded: boxes.single.uploaded,
                          tint: AppColors.pinkGradientStart,
                          onUpload: boxes.single.onUpload,
                          onRemove: boxes.single.onRemove,
                        ),
                    ],
                  );
                }(),
              ],
            ],
          ),
        ),
        if (garmentType != null) ...[
          () {
            final templatesKey = (
              gender: selection.gender,
              garmentTypeId: garmentType.id,
            );
            final templatesAsync = ref.watch(
              catalogueTemplatesProvider(templatesKey),
            );
            // Mirrors the web app exactly: the Ready-Made/Create-Your-Own
            // toggle only exists when this garment type actually has
            // templates. While the first fetch is in flight we keep the
            // toggle visible (avoids a flash-hide-flash), but once it
            // resolves empty the toggle disappears and — via the listener
            // below — any lingering readyMade selection is forced back to
            // createYourOwn, exactly like studio/page.tsx's safety-net effect.
            final hasTemplates = templatesAsync.when(
              data: (templates) => templates.isNotEmpty,
              loading: () => true,
              error: (_, _) => false,
            );
            ref.listen(catalogueTemplatesProvider(templatesKey), (
              previous,
              next,
            ) {
              final templates = next.value;
              if (templates != null && templates.isEmpty) {
                controller.ensureCreateYourOwnIfNoTemplates();
              }
            });

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(height: sectionGap),
                BorderedCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const WizardStepHeader(
                        number: 2,
                        title: AppStrings.chooseYourLookStep,
                      ),
                      SizedBox(height: sectionGap),
                      if (hasTemplates) ...[
                        FilterTabs(
                          options: const [
                            AppStrings.createYourOwn,
                            AppStrings.readyMadeLook,
                          ],
                          selected: selection.lookMode == LookMode.readyMade
                              ? AppStrings.readyMadeLook
                              : AppStrings.createYourOwn,
                          icons: const {
                            AppStrings.readyMadeLook:
                                Icons.auto_awesome_rounded,
                            AppStrings.createYourOwn:
                                Icons.dashboard_customize_rounded,
                          },
                          onSelected: (v) => controller.setLookMode(
                            v == AppStrings.readyMadeLook
                                ? LookMode.readyMade
                                : LookMode.createYourOwn,
                          ),
                        ),
                        SizedBox(height: sectionGap),
                      ],
                      Text(AppStrings.modelLabel, style: _labelStyle(context)),
                      SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                      Consumer(
                        builder: (context, ref, _) {
                          final facesAsync = ref.watch(
                            facesProvider(selection.gender),
                          );
                          return facesAsync.when(
                            loading: () => _thumbnailRowSkeleton(context),
                            error: (_, _) => const InlineErrorBanner(
                              message: 'Could not load models.',
                            ),
                            data: (facesRaw) {
                              // A selection made from the "More" sheet keeps
                              // showing in this compact row instead of
                              // possibly landing outside its visible slots.
                              final faces = withSelectedFirst(
                                facesRaw,
                                (f) => f.id,
                                {
                                  if (selection.faceId != null)
                                    selection.faceId!,
                                },
                              );
                              final thumbs = [
                                for (final face in faces)
                                  (
                                    id: face.id,
                                    label: face.label,
                                    imageUrl: face.thumbnailUrl,
                                    tint: AppColors.pinkGradientStart,
                                  ),
                              ];
                              return LimitedThumbnailRow(
                                itemCount: faces.length,
                                spacing: tileGap,
                                itemBuilder:
                                    (context, index, tileWidth, tileHeight) {
                                      final face = faces[index];
                                      return SelectableThumbnailTile(
                                        icon: Icons.face_rounded,
                                        imageUrl: face.thumbnailUrl,
                                        tint: AppColors.pinkGradientStart,
                                        width: tileWidth,
                                        height: tileHeight,
                                        radius: AppDimens.sdp(context, '_6sdp'),
                                        selected: face.id == selection.faceId,
                                        onTap: () =>
                                            controller.selectFace(face.id),
                                      );
                                    },
                                onMore: () async {
                                  final picked =
                                      await showSingleThumbnailPickerSheet(
                                        context,
                                        title: AppStrings.modelLabel,
                                        items: thumbs,
                                        selectedId: selection.faceId,
                                      );
                                  if (picked != null) {
                                    controller.selectFace(picked);
                                  }
                                },
                              );
                            },
                          );
                        },
                      ),
                      SizedBox(height: sectionGap),
                      if (selection.lookMode == LookMode.readyMade) ...[
                        Text(
                          AppStrings.selectAnyPreset,
                          style: _labelStyle(context),
                        ),
                        SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                        Consumer(
                          builder: (context, ref, _) {
                            final templatesAsync = ref.watch(
                              catalogueTemplatesProvider((
                                gender: selection.gender,
                                garmentTypeId: garmentType.id,
                              )),
                            );
                            return templatesAsync.when(
                              loading: () => SizedBox(
                                height: presetRowHeight,
                                child: _thumbnailRowSkeleton(context),
                              ),
                              error: (_, _) => const InlineErrorBanner(
                                message: 'Could not load looks.',
                              ),
                              data: (templates) => LayoutBuilder(
                                builder: (context, constraints) {
                                  // Same tile-size formula as every other
                                  // row in this form (LimitedThumbnailRow):
                                  // divide by a fixed reference slot count,
                                  // not this row's own item count, so tiles
                                  // here end up the same size as Model/
                                  // Background/Lower Garment/Footwear
                                  // instead of the old fixed, noticeably
                                  // smaller 80sdp square.
                                  final tileWidth =
                                      LimitedThumbnailRow.tileWidthFor(
                                        constraints.maxWidth,
                                        tileGap,
                                      );
                                  final tileHeight = tileWidth / 0.81;
                                  // Same caption-allowance convention as the
                                  // "More" sheet's grid (_ThumbnailPickerGrid
                                  // in detail_page_widgets.dart).
                                  final captionAllowance = AppDimens.sdp(
                                    context,
                                    '_28sdp',
                                  );
                                  return SizedBox(
                                    height: tileHeight + captionAllowance,
                                    child: ListView.separated(
                                      scrollDirection: Axis.horizontal,
                                      // The selected tile's check badge sits
                                      // 4px outside the tile's top-right
                                      // corner; the list's default clip cut
                                      // it (and the border edge) off. Every
                                      // other row here is a plain Row, which
                                      // doesn't clip.
                                      clipBehavior: Clip.none,
                                      itemCount: templates.length,
                                      separatorBuilder: (_, _) =>
                                          SizedBox(width: tileGap),
                                      itemBuilder: (context, index) {
                                        final template = templates[index];
                                        return SelectableThumbnailTile(
                                          icon: Icons.landscape_rounded,
                                          imageUrl: template.thumbnailUrl,
                                          tint: AppColors.pinkGradientStart,
                                          caption: template.label,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_6sdp',
                                          ),
                                          selected:
                                              template.id ==
                                              selection.selectedTemplate?.id,
                                          onTap: () => controller
                                              .selectTemplate(template),
                                        );
                                      },
                                    ),
                                  );
                                },
                              ),
                            );
                          },
                        ),
                        if (selection.selectedTemplate != null) ...[
                          SizedBox(height: sectionGap),
                          Builder(
                            builder: (context) {
                              final looks = selection.selectedTemplate!.looks;
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    AppStrings.posesSelected(
                                      selection.selectedLookIds.length,
                                    ),
                                    style: _labelStyle(context),
                                  ),
                                  SizedBox(
                                    height: AppDimens.sdp(context, '_14sdp'),
                                  ),
                                  ThumbnailTileRow(
                                    itemCount: looks.length,
                                    spacing: tileGap,
                                    itemBuilder:
                                        (
                                          context,
                                          index,
                                          tileWidth,
                                          tileHeight,
                                        ) {
                                          final look = looks[index];
                                          // All start selected; the user keeps
                                          // one or several (web's look toggle).
                                          return SelectableThumbnailTile(
                                            icon:
                                                Icons.accessibility_new_rounded,
                                            imageUrl: look.poseThumbnailUrl,
                                            tint: AppColors.infoBlue,
                                            width: tileWidth,
                                            height: tileHeight,
                                            radius: AppDimens.sdp(
                                              context,
                                              '_6sdp',
                                            ),
                                            selected: selection.selectedLookIds
                                                .contains(look.id),
                                            onTap: () =>
                                                controller.toggleLook(look.id),
                                          );
                                        },
                                  ),
                                ],
                              );
                            },
                          ),
                        ],
                      ] else ...[
                        // The label, its list and the gap after it all live
                        // inside the Consumer so that with no saved poses
                        // (loading, error or none yet) nothing renders —
                        // a bare "Saved poses" heading over empty space
                        // looked like a bug.
                        Consumer(
                          builder: (context, ref, _) {
                            final presetsAsync = ref.watch(
                              posePresetsProvider((
                                gender: selection.gender,
                                garmentTypeId: garmentType.id,
                              )),
                            );
                            return presetsAsync.when(
                              loading: () => const SizedBox.shrink(),
                              error: (_, _) => const SizedBox.shrink(),
                              data: (response) {
                                final presets = [
                                  if (response.lastUsed != null)
                                    response.lastUsed!,
                                  ...response.named,
                                ];
                                if (presets.isEmpty) {
                                  return const SizedBox.shrink();
                                }
                                return Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Saved poses',
                                      style: _labelStyle(context),
                                    ),
                                    SizedBox(
                                      height: AppDimens.sdp(context, '_14sdp'),
                                    ),
                                    SizedBox(
                                      height: chipRowHeight,
                                      child: ListView.separated(
                                        scrollDirection: Axis.horizontal,
                                        itemCount: presets.length,
                                        separatorBuilder: (_, _) => SizedBox(
                                          width: AppDimens.sdp(
                                            context,
                                            '_8sdp',
                                          ),
                                        ),
                                        itemBuilder: (context, index) {
                                          final preset = presets[index];
                                          final isActive = setEquals(
                                            selection.poseIds,
                                            preset.poseIds.toSet(),
                                          );
                                          return GestureDetector(
                                            onLongPress: preset.isLastUsed
                                                ? null
                                                : () => _deletePosePreset(
                                                    controller,
                                                    selection.gender,
                                                    garmentType.id,
                                                    preset,
                                                  ),
                                            child: FilterChoiceChip(
                                              label: preset.name,
                                              selected: isActive,
                                              icon: preset.isLastUsed
                                                  ? Icons.history_rounded
                                                  : null,
                                              onTap: () =>
                                                  controller.applyPosePreset(
                                                    preset.poseIds.toSet(),
                                                  ),
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                    SizedBox(height: sectionGap),
                                  ],
                                );
                              },
                            );
                          },
                        ),
                        Text(
                          AppStrings.backgroundLabel,
                          style: _labelStyle(context),
                        ),
                        SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                        Consumer(
                          builder: (context, ref, _) {
                            final categoriesAsync = ref.watch(
                              backgroundCategoriesProvider(selection.gender),
                            );
                            return categoriesAsync.when(
                              loading: () => const SizedBox.shrink(),
                              error: (_, _) => const SizedBox.shrink(),
                              data: (categories) {
                                if (categories.isEmpty) {
                                  return const SizedBox.shrink();
                                }
                                return Padding(
                                  padding: EdgeInsets.only(
                                    bottom: AppDimens.sdp(context, '_10sdp'),
                                  ),
                                  child: SizedBox(
                                    height: chipRowHeight,
                                    child: ListView.separated(
                                      scrollDirection: Axis.horizontal,
                                      itemCount: categories.length + 1,
                                      separatorBuilder: (_, _) => SizedBox(
                                        width: AppDimens.sdp(context, '_8sdp'),
                                      ),
                                      itemBuilder: (context, index) {
                                        if (index == 0) {
                                          return FilterChoiceChip(
                                            label: 'All',
                                            selected:
                                                _selectedBackgroundCategoryId ==
                                                null,
                                            onTap: () => setState(
                                              () =>
                                                  _selectedBackgroundCategoryId =
                                                      null,
                                            ),
                                          );
                                        }
                                        final category = categories[index - 1];
                                        return FilterChoiceChip(
                                          label: category.label,
                                          selected:
                                              _selectedBackgroundCategoryId ==
                                              category.id,
                                          onTap: () => setState(
                                            () =>
                                                _selectedBackgroundCategoryId =
                                                    category.id,
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                        Consumer(
                          builder: (context, ref, _) {
                            final myBackgroundsAsync = ref.watch(
                              myBackgroundsProvider,
                            );
                            final backgroundsAsync = ref.watch(
                              backgroundsProvider(selection.gender),
                            );
                            return backgroundsAsync.when(
                              loading: () => _thumbnailRowSkeleton(context),
                              error: (_, _) => const InlineErrorBanner(
                                message: 'Could not load backgrounds.',
                              ),
                              data: (backgroundsRaw) {
                                final myBackgrounds =
                                    myBackgroundsAsync.value ?? [];
                                final backgrounds =
                                    _selectedBackgroundCategoryId == null
                                    ? backgroundsRaw
                                    : backgroundsRaw
                                          .where(
                                            (b) =>
                                                b.categoryId ==
                                                _selectedBackgroundCategoryId,
                                          )
                                          .toList();
                                final myIds = myBackgrounds
                                    .map((b) => b.id)
                                    .toSet();
                                // Captioned in the "More" sheet (there's room), plain
                                // tiles in the compact row (a caption here would
                                // overflow the row's fixed tile height at 4-per-row).
                                final thumbs = [
                                  for (final bg in myBackgrounds)
                                    (
                                      id: bg.id,
                                      label: bg.label,
                                      imageUrl: bg.thumbnailUrl,
                                      tint: AppColors.success,
                                    ),
                                  for (final bg in backgrounds)
                                    (
                                      id: bg.id,
                                      label: bg.label,
                                      imageUrl: bg.thumbnailUrl,
                                      tint: AppColors.violet,
                                    ),
                                ];
                                // A selection made from the "More" sheet
                                // keeps showing in this compact row instead
                                // of possibly landing outside its visible
                                // slots.
                                final orderedThumbs = withSelectedFirst(
                                  thumbs,
                                  (t) => t.id,
                                  {
                                    if (selection.backgroundId != null)
                                      selection.backgroundId!,
                                  },
                                );
                                return LimitedThumbnailRow(
                                  itemCount: orderedThumbs.length,
                                  visibleCount: 3,
                                  spacing: tileGap,
                                  leading: (tileWidth, tileHeight) =>
                                      _UploadBackgroundTile(
                                        width: tileWidth,
                                        height: tileHeight,
                                        uploading:
                                            selection.isUploadingBackground,
                                        onTap: () => _addBackground(controller),
                                      ),
                                  itemBuilder:
                                      (context, index, tileWidth, tileHeight) {
                                        final thumb = orderedThumbs[index];
                                        final tile = SelectableThumbnailTile(
                                          icon: Icons.landscape_rounded,
                                          imageUrl: thumb.imageUrl,
                                          tint: thumb.tint,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_6sdp',
                                          ),
                                          selected:
                                              thumb.id ==
                                              selection.backgroundId,
                                          onTap: () => controller
                                              .selectBackground(thumb.id),
                                        );
                                        return myIds.contains(thumb.id)
                                            ? _DeletableThumbnail(
                                                onDelete: () =>
                                                    _deleteCustomBackground(
                                                      controller,
                                                      thumb.id,
                                                      thumb.label,
                                                    ),
                                                child: tile,
                                              )
                                            : tile;
                                      },
                                  onMore: () async {
                                    final picked =
                                        await showSingleThumbnailPickerSheet(
                                          context,
                                          title: AppStrings.backgroundLabel,
                                          items: thumbs,
                                          selectedId: selection.backgroundId,
                                        );
                                    if (picked != null) {
                                      controller.selectBackground(picked);
                                    }
                                  },
                                );
                              },
                            );
                          },
                        ),
                        SizedBox(height: sectionGap),
                        Text(
                          AppStrings.posesSelected(selection.poseIds.length),
                          style: _labelStyle(context),
                        ),
                        SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                        Consumer(
                          builder: (context, ref, _) {
                            final posesAsync = ref.watch(
                              posesProvider((
                                gender: selection.gender,
                                garmentTypeId: garmentType.id,
                              )),
                            );
                            return posesAsync.when(
                              loading: () => _thumbnailRowSkeleton(context),
                              error: (_, _) => const InlineErrorBanner(
                                message: 'Could not load poses.',
                              ),
                              data: (posesRaw) {
                                // Selections made from the "More" sheet keep
                                // showing in this compact row instead of
                                // possibly landing outside its visible slots.
                                final poses = withSelectedFirst(
                                  posesRaw,
                                  (p) => p.id,
                                  selection.poseIds,
                                );
                                final thumbs = [
                                  for (final pose in poses)
                                    (
                                      id: pose.id,
                                      label: pose.label,
                                      imageUrl: pose.thumbnailUrl,
                                      tint: AppColors.infoBlue,
                                    ),
                                ];
                                return LimitedThumbnailRow(
                                  itemCount: poses.length,
                                  spacing: tileGap,
                                  itemBuilder:
                                      (context, index, tileWidth, tileHeight) {
                                        final pose = poses[index];
                                        return SelectableThumbnailTile(
                                          icon: Icons.accessibility_new_rounded,
                                          imageUrl: pose.thumbnailUrl,
                                          tint: AppColors.infoBlue,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_6sdp',
                                          ),
                                          selected: selection.poseIds.contains(
                                            pose.id,
                                          ),
                                          onTap: () =>
                                              controller.togglePose(pose.id),
                                        );
                                      },
                                  onMore: () async {
                                    final picked =
                                        await showMultiThumbnailPickerSheet(
                                          context,
                                          title: 'Choose Poses',
                                          items: thumbs,
                                          selectedIds: selection.poseIds,
                                        );
                                    if (picked != null) {
                                      controller.applyPosePreset(picked);
                                    }
                                  },
                                );
                              },
                            );
                          },
                        ),
                      ],
                      SizedBox(height: sectionGap),
                      Consumer(
                        builder: (context, ref, _) {
                          final template = selection.selectedTemplate;
                          bool needsLower;
                          bool needsShoes;
                          // Mirrors the web app's effectivePoseIds exactly:
                          // custom mode's own pose selection, or the
                          // ready-made template's looks' poses — this is
                          // what the server actually validates lower/shoe
                          // availability against (see poseIdsKey doc on the
                          // provider), not just this row's own hasLower/
                          // hasShoes client-side pre-check.
                          final List<String> effectivePoseIds;
                          if (selection.lookMode == LookMode.readyMade) {
                            final looks = (template?.looks ?? const [])
                                .where(
                                  (l) =>
                                      selection.selectedLookIds.contains(l.id),
                                )
                                .toList();
                            needsLower = looks.any((l) => l.hasLower);
                            needsShoes = looks.any((l) => l.hasShoes);
                            effectivePoseIds = looks
                                .map((l) => l.poseId)
                                .toList();
                          } else {
                            final poses =
                                ref
                                    .watch(
                                      posesProvider((
                                        gender: selection.gender,
                                        garmentTypeId: garmentType.id,
                                      )),
                                    )
                                    .value ??
                                const [];
                            final selectedPoses = poses.where(
                              (p) => selection.poseIds.contains(p.id),
                            );
                            needsLower = selectedPoses.any((p) => p.hasLower);
                            needsShoes = selectedPoses.any((p) => p.hasShoes);
                            effectivePoseIds = selection.poseIds.toList();
                          }

                          // Mirrors studio/page.tsx's extraSectionKeys
                          // exactly: `needsLower && !requiresLowerUpload`.
                          // When the garment type itself requires the user
                          // to upload their own lower-garment photo directly
                          // (e.g. a Kurti & Pyjama combo), that upload
                          // already satisfies the pose's lower-garment need,
                          // so a second, redundant "Bottom Wear" catalog
                          // picker on top of it would be wrong.
                          //
                          // isBottomWearOnly has no web equivalent — it's an
                          // Android-only addition for garment types (Jean,
                          // Trouser, Skirt, ...) whose *single* upload is
                          // itself the lower garment, which web doesn't
                          // special-case either (see its doc comment).
                          // Footwear has no carve-out at all: choosing shoes
                          // stays meaningful regardless of what's on top.
                          final showLower =
                              needsLower &&
                              !garmentType.requiresLowerUpload &&
                              !garmentType.isBottomWearOnly;

                          if (!showLower && !needsShoes) {
                            return const SizedBox.shrink();
                          }

                          final poseIdsKey = (effectivePoseIds.toList()..sort())
                              .join(',');

                          // The 'other' node is the server's synthetic
                          // uncategorized-items bucket — the web app
                          // explicitly excludes it from what it shows
                          // (studio/page.tsx's lowerNodes/shoeNodes), so
                          // this does too. Kept as real tree nodes (not
                          // flattened yet) so the "More" sheet can offer
                          // them as filter categories, same as web's own
                          // "View more" modal.
                          final lowerNodes = showLower
                              ? (ref
                                        .watch(
                                          lowerCatalogProvider((
                                            gender: selection.gender,
                                            garmentTypeId: garmentType.id,
                                            poseIdsKey: poseIdsKey,
                                          )),
                                        )
                                        .value
                                        ?.tree
                                        .where((n) => n.slug != 'other')
                                        .toList() ??
                                    const <CatalogNode>[])
                              : const <CatalogNode>[];
                          final shoeNodes = needsShoes
                              ? (ref
                                        .watch(
                                          shoeCatalogProvider((
                                            gender: selection.gender,
                                            garmentTypeId: garmentType.id,
                                            poseIdsKey: poseIdsKey,
                                          )),
                                        )
                                        .value
                                        ?.tree
                                        .where((n) => n.slug != 'other')
                                        .toList() ??
                                    const <CatalogNode>[])
                              : const <CatalogNode>[];
                          final lowerItems = lowerNodes
                              .expand(_flattenNode)
                              .toList();
                          final shoeItems = shoeNodes
                              .expand(_flattenNode)
                              .toList();
                          // A selection made from the "More" sheet keeps
                          // showing in the compact row instead of possibly
                          // landing outside its visible slots.
                          final orderedLowerItems = withSelectedFirst(
                            lowerItems,
                            (i) => i.id,
                            {
                              if (selection.lowerCatalogItemId != null)
                                selection.lowerCatalogItemId!,
                            },
                          );
                          final orderedShoeItems = withSelectedFirst(
                            shoeItems,
                            (i) => i.id,
                            {
                              if (selection.shoeCatalogItemId != null)
                                selection.shoeCatalogItemId!,
                            },
                          );
                          // Categories for the "More" sheet's filter dropdown
                          // — one per real catalog-tree node (e.g. "Mini
                          // skirts", "Trousers"), each carrying just its own
                          // items. Mirrors the web app's "View more" modal,
                          // whose category pills are exactly these same
                          // tree nodes.
                          final lowerCategories = [
                            for (final node in lowerNodes)
                              (
                                id: node.slug,
                                label: node.label,
                                items: [
                                  for (final item in _flattenNode(node))
                                    (
                                      id: item.id,
                                      label: item.label,
                                      imageUrl: item.thumbnailUrl,
                                      tint: AppColors.pinkGradientStart,
                                    ),
                                ],
                              ),
                          ];
                          final shoeCategories = [
                            for (final node in shoeNodes)
                              (
                                id: node.slug,
                                label: node.label,
                                items: [
                                  for (final item in _flattenNode(node))
                                    (
                                      id: item.id,
                                      label: item.label,
                                      imageUrl: item.thumbnailUrl,
                                      tint: AppColors.infoBlue,
                                    ),
                                ],
                              ),
                          ];

                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (showLower) ...[
                                Text(
                                  AppStrings.bottomWearLabel,
                                  style: _labelStyle(context),
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(context, '_14sdp'),
                                ),
                                LimitedThumbnailRow(
                                  itemCount: orderedLowerItems.length,
                                  spacing: tileGap,
                                  itemBuilder:
                                      (context, index, tileWidth, tileHeight) {
                                        final item = orderedLowerItems[index];
                                        return SelectableThumbnailTile(
                                          icon: Icons.checkroom_rounded,
                                          imageUrl: item.thumbnailUrl,
                                          tint: AppColors.pinkGradientStart,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_6sdp',
                                          ),
                                          selected:
                                              item.id ==
                                              selection.lowerCatalogItemId,
                                          onTap: () => controller
                                              .selectLowerCatalogItem(item.id),
                                        );
                                      },
                                  onMore: () async {
                                    final picked =
                                        await showFilterableThumbnailPickerSheet(
                                          context,
                                          title: AppStrings.bottomWearLabel,
                                          categories: lowerCategories,
                                          selectedId:
                                              selection.lowerCatalogItemId,
                                        );
                                    if (picked != null) {
                                      controller.selectLowerCatalogItem(picked);
                                    }
                                  },
                                ),
                              ],
                              if (showLower && needsShoes)
                                SizedBox(height: sectionGap),
                              if (needsShoes) ...[
                                Text(
                                  AppStrings.footWearLabel,
                                  style: _labelStyle(context),
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(context, '_14sdp'),
                                ),
                                LimitedThumbnailRow(
                                  itemCount: orderedShoeItems.length,
                                  spacing: tileGap,
                                  itemBuilder:
                                      (context, index, tileWidth, tileHeight) {
                                        final item = orderedShoeItems[index];
                                        return SelectableThumbnailTile(
                                          icon: Icons.hiking_rounded,
                                          imageUrl: item.thumbnailUrl,
                                          tint: AppColors.infoBlue,
                                          width: tileWidth,
                                          height: tileHeight,
                                          radius: AppDimens.sdp(
                                            context,
                                            '_6sdp',
                                          ),
                                          selected:
                                              item.id ==
                                              selection.shoeCatalogItemId,
                                          onTap: () => controller
                                              .selectShoeCatalogItem(item.id),
                                        );
                                      },
                                  onMore: () async {
                                    final picked =
                                        await showFilterableThumbnailPickerSheet(
                                          context,
                                          title: AppStrings.footWearLabel,
                                          categories: shoeCategories,
                                          selectedId:
                                              selection.shoeCatalogItemId,
                                        );
                                    if (picked != null) {
                                      controller.selectShoeCatalogItem(picked);
                                    }
                                  },
                                ),
                              ],
                            ],
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            );
          }(),
          SizedBox(height: sectionGap),
          BorderedCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const WizardStepHeader(
                  number: 3,
                  title: AppStrings.setYourOutputStep,
                ),
                SizedBox(height: sectionGap),
                Row(
                  children: [
                    Expanded(
                      child: LabeledDropdownField(
                        label: AppStrings.platformLabel,
                        value: selection.platform,
                        onTap: () => _pick(
                          title: AppStrings.platformLabel,
                          options: _platformOptions,
                          selected: selection.platform,
                          onSelected: controller.selectPlatform,
                        ),
                      ),
                    ),
                    SizedBox(width: fieldGap),
                    Expanded(
                      child: LabeledDropdownField(
                        label: AppStrings.aspectRatioLabel,
                        value: selection.aspectRatio,
                        onTap: () => _pick(
                          title: AppStrings.aspectRatioLabel,
                          options: _aspectRatioOptions,
                          selected: selection.aspectRatio,
                          onSelected: controller.selectAspectRatio,
                        ),
                      ),
                    ),
                    SizedBox(width: fieldGap),
                    Expanded(
                      child: Consumer(
                        builder: (context, ref, _) {
                          final resolutionsAsync = ref.watch(
                            resolutionsConfigProvider,
                          );
                          return resolutionsAsync.when(
                            loading: () => LabeledDropdownField(
                              label: AppStrings.resolutionLabel,
                              value: 'Loading…',
                              onTap: () {},
                            ),
                            error: (_, _) => LabeledDropdownField(
                              label: AppStrings.resolutionLabel,
                              value: selection.resolution,
                              onTap: () {},
                            ),
                            data: (config) {
                              final enabled = config.resolutions.entries
                                  .where((e) => e.value.enabled)
                                  .toList();
                              return LabeledDropdownField(
                                label: AppStrings.resolutionLabel,
                                value: selection.resolution,
                                onTap: () => _pick(
                                  title: AppStrings.resolutionLabel,
                                  options: enabled
                                      .map(
                                        (e) =>
                                            '${e.key} (${e.value.creditCost} Credits)',
                                      )
                                      .toList(),
                                  selected: selection.resolution,
                                  onSelected: (v) => controller
                                      .selectResolution(v.split(' ').first),
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
        SizedBox(height: sectionGap),
        if (_submitError != null) ...[
          InlineErrorBanner(message: _submitError!),
          SizedBox(height: sectionGap),
        ],
        GradientButton(
          key: _generateKey,
          label:
              '${AppStrings.generateCatalogue} '
              '${AppStrings.creditsSuffix(creditsForSelection(selection, ref.watch(resolutionsConfigProvider).value))}',
          isLoading: _isSubmitting,
          // Stays disabled (faded pink, via GradientButton's own dimming)
          // until the garment photo — the one input every garment type
          // requires — is uploaded, so the button only lights up once
          // Generate would actually have something to work with. Saree also
          // requires the pallu photo before it's ready.
          onPressed: _canGenerate(selection, garmentType) ? _generate : null,
          icon: Icon(
            Icons.auto_awesome_rounded,
            color: Colors.white,
            size: AppDimens.sdp(context, '_18sdp'),
          ),
        ),
      ],
    );
  }

  /// A label with an optional trailing info icon — shared by [_uploadSection]
  /// (single-upload garment types) and the standalone headline above
  /// Body/Pallu (two-input Saree, where "Upload Your Garment" names the
  /// whole pair rather than either box individually).
  Widget _labelWithInfoRow(
    BuildContext context,
    String label, {
    required TextStyle style,
    VoidCallback? onInfoTap,
    Key? infoKey,
  }) {
    if (onInfoTap == null) return Text(label, style: style);
    return Row(
      children: [
        Text(label, style: style),
        const Spacer(),
        Material(
          key: infoKey,
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            onTap: onInfoTap,
            customBorder: const CircleBorder(),
            // A bare 2sdp of padding around an 18sdp icon left a ~22sdp tap
            // target — well under Android's 48dp touch-target guidance, so
            // taps near the icon's edge silently missed. 8sdp padding around
            // a bigger 24sdp icon gives a ~40sdp target instead, and Material
            // (rather than a bare InkWell) makes sure the ripple actually
            // paints instead of being clipped away with nothing to draw on.
            child: Padding(
              padding: EdgeInsets.all(AppDimens.sdp(context, '_8sdp')),
              child: Icon(
                Icons.info_outline_rounded,
                color: AppColors.textSecondary,
                size: AppDimens.sdp(context, '_24sdp'),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _thumbnailRowSkeleton(BuildContext context) {
    return SizedBox(
      height: AppDimens.sdp(context, '_64sdp'),
      child: const AppLoader(),
    );
  }

  TextStyle _labelStyle(BuildContext context) => AppTextStyles.medium.copyWith(
    color: Colors.white,
    fontSize: AppDimens.ssp(context, '_12ssp'),
  );

  TextStyle _headlineStyle(BuildContext context) =>
      AppTextStyles.semiBold.copyWith(
        color: Colors.white,
        fontSize: AppDimens.ssp(context, '_15ssp'),
      );
}

Iterable<CatalogItem> _flattenNode(CatalogNode node) sync* {
  yield* node.items;
  for (final child in node.children) {
    yield* _flattenNode(child);
  }
}

class _DeletableThumbnail extends StatelessWidget {
  const _DeletableThumbnail({required this.child, required this.onDelete});

  final Widget child;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          top: -AppDimens.sdp(context, '_4sdp'),
          left: -AppDimens.sdp(context, '_4sdp'),
          child: InkWell(
            onTap: onDelete,
            customBorder: const CircleBorder(),
            child: Container(
              padding: EdgeInsets.all(AppDimens.sdp(context, '_3sdp')),
              decoration: const BoxDecoration(
                color: Colors.black,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.close_rounded,
                color: Colors.white,
                size: AppDimens.sdp(context, '_10sdp'),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _UploadBackgroundTile extends StatelessWidget {
  const _UploadBackgroundTile({
    required this.width,
    required this.height,
    required this.uploading,
    required this.onTap,
  });

  final double width;
  final double height;
  final bool uploading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));

    return GestureDetector(
      onTap: uploading ? null : onTap,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.fieldFill,
          border: Border.all(color: AppColors.fieldBorder),
          borderRadius: radius,
        ),
        alignment: Alignment.center,
        child: uploading
            ? const AppLoader()
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.add_photo_alternate_outlined,
                    color: AppColors.textSecondary,
                    size: AppDimens.sdp(context, '_22sdp'),
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                  Text(
                    'Upload',
                    style: AppTextStyles.medium.copyWith(
                      color: AppColors.textSecondary,
                      fontSize: AppDimens.ssp(context, '_10ssp'),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _UploadGarmentBox extends StatelessWidget {
  const _UploadGarmentBox({
    super.key,
    required this.label,
    required this.file,
    required this.uploading,
    required this.uploaded,
    required this.tint,
    required this.onUpload,
    required this.onRemove,
    this.largeThumbnail = false,
  });

  final String label;
  final File? file;
  final bool uploading;
  final bool uploaded;
  final Color tint;
  final VoidCallback onUpload;
  final VoidCallback onRemove;

  /// True when this box shares a row with sibling uploads (Body+Pallu, or
  /// upper+lower+third) — the uploaded photo then fills the whole box with
  /// just a small remove button, instead of the single-box "Garment
  /// Uploaded" summary row, which has no room to repeat per box.
  final bool largeThumbnail;

  @override
  Widget build(BuildContext context) {
    final radiusValue = AppDimens.sdp(context, '_14sdp');
    final radius = BorderRadius.circular(radiusValue);

    if (!uploaded && !uploading) {
      final placeholder = DashedBorderContainer(
        borderRadius: radiusValue,
        child: InkWell(
          onTap: onUpload,
          borderRadius: radius,
          child: Container(
            width: double.infinity,
            height: largeThumbnail ? double.infinity : null,
            padding: EdgeInsets.symmetric(
              vertical: AppDimens.sdp(
                context,
                largeThumbnail ? '_10sdp' : '_16sdp',
              ),
              horizontal: AppDimens.sdp(context, '_8sdp'),
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.03),
              borderRadius: radius,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _UploadPlaceholderIcon(
                  size: AppDimens.sdp(context, '_26sdp'),
                ),
                SizedBox(height: AppDimens.sdp(context, '_6sdp')),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  AppStrings.uploadFileTypeHint,
                  textAlign: TextAlign.center,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_10ssp'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      return largeThumbnail
          ? AspectRatio(aspectRatio: 1.05, child: placeholder)
          : placeholder;
    }

    if (largeThumbnail) {
      return AspectRatio(
        aspectRatio: 1.05,
        child: DashedBorderContainer(
          borderRadius: radiusValue,
          child: ClipRRect(
            borderRadius: radius,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(
                  color: AppColors.photoThumbnailBackground,
                  child: uploading
                      ? const AppLoader()
                      : (file != null
                            ? Image.file(file!, fit: BoxFit.cover)
                            : Icon(Icons.checkroom_rounded, color: tint)),
                ),
                if (!uploading)
                  Positioned(
                    top: AppDimens.sdp(context, '_6sdp'),
                    right: AppDimens.sdp(context, '_6sdp'),
                    child: InkWell(
                      onTap: onRemove,
                      customBorder: const CircleBorder(),
                      child: Container(
                        padding: EdgeInsets.all(
                          AppDimens.sdp(context, '_4sdp'),
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.55),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.close_rounded,
                          color: Colors.white,
                          size: AppDimens.sdp(context, '_14sdp'),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    }

    final thumbSize = AppDimens.sdp(context, '_55sdp');

    return DashedBorderContainer(
      borderRadius: radiusValue,
      child: Container(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.03),
          borderRadius: radius,
        ),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(
                    AppDimens.sdp(context, '_6sdp'),
                  ),
                  child: Container(
                    width: thumbSize,
                    height: thumbSize,
                    color: AppColors.photoThumbnailBackground,
                    child: file != null
                        ? Image.file(file!, fit: BoxFit.cover)
                        : Icon(
                            Icons.checkroom_rounded,
                            color: tint,
                            size: thumbSize * 0.45,
                          ),
                  ),
                ),
                if (!uploading)
                  Positioned(
                    top: -AppDimens.sdp(context, '_6sdp'),
                    right: -AppDimens.sdp(context, '_6sdp'),
                    child: InkWell(
                      onTap: onRemove,
                      customBorder: const CircleBorder(),
                      child: Container(
                        padding: EdgeInsets.all(
                          AppDimens.sdp(context, '_3sdp'),
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.55),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.close_rounded,
                          color: Colors.white,
                          size: AppDimens.sdp(context, '_12sdp'),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            SizedBox(width: AppDimens.sdp(context, '_14sdp')),
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      uploading ? 'Uploading…' : AppStrings.garmentUploaded,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                  if (uploading)
                    const AppLoader.small()
                  else
                    Icon(
                      Icons.check_circle_rounded,
                      color: AppColors.pinkGradientStart,
                      size: AppDimens.sdp(context, '_16sdp'),
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

/// The "add a photo" placeholder icon used by an empty [_UploadGarmentBox] —
/// a plain image glyph with a small pink "+" badge overlapping its corner,
/// matching the Figma reference (replaces the old plain cloud-upload icon).
class _UploadPlaceholderIcon extends StatelessWidget {
  const _UploadPlaceholderIcon({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    final badgeSize = size * 0.45;
    return SizedBox(
      width: size + badgeSize / 2,
      height: size + badgeSize / 2,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Icon(
            Icons.image_outlined,
            color: AppColors.textSecondary,
            size: size,
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: badgeSize,
              height: badgeSize,
              decoration: BoxDecoration(
                color: AppColors.pinkGradientStart,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.background, width: 2),
              ),
              alignment: Alignment.center,
              child: Icon(
                Icons.add,
                color: Colors.white,
                size: badgeSize * 0.6,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/catalog_node.dart';
import '../data/models/catalogue_template.dart';
import '../data/models/garment_type.dart';
import '../data/models/gender.dart';
import '../data/models/tryon_submit_result.dart';
import 'catalogue_selection_state.dart';
import 'studio_providers.dart';
import 'studio_reference_providers.dart';

Iterable<CatalogItem> _flattenCatalogNode(CatalogNode node) sync* {
  yield* node.items;
  for (final child in node.children) {
    yield* _flattenCatalogNode(child);
  }
}

class CatalogueSelectionController extends Notifier<CatalogueSelectionState> {
  @override
  CatalogueSelectionState build() => const CatalogueSelectionState();

  void selectGender(Gender gender) {
    state = CatalogueSelectionState(gender: gender, platform: state.platform);
    _autoSelectFirstGarmentType(gender);
  }

  /// Called once from the form's `initState` — picks a default garment type
  /// for the initial gender the same way [selectGender] does for a switch,
  /// so the wizard never sits on step 1 with nothing selected.
  void ensureDefaultGarmentType() {
    if (state.garmentType != null) return;
    _autoSelectFirstGarmentType(state.gender);
  }

  /// Mirrors the web app: switching "Catalogue For" auto-selects the first
  /// garment type for that gender (by the server's own sort order) rather
  /// than leaving the picker empty. Runs as a plain async continuation for
  /// the same reason [_prefillLastUsedPreset] does — mutating state as a
  /// side effect of a widget's build/watch can corrupt Flutter's layout
  /// dirty-tracking.
  Future<void> _autoSelectFirstGarmentType(Gender gender) async {
    try {
      final garmentTypes = await ref.read(garmentTypesProvider(gender).future);
      final stillSameSelection =
          state.gender == gender && state.garmentType == null;
      if (garmentTypes.isNotEmpty && stillSameSelection) {
        selectGarmentType(garmentTypes.first);
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  void selectGarmentType(GarmentType garmentType) {
    state = state.copyWith(
      garmentType: garmentType,
      faceId: null,
      selectedTemplate: null,
      backgroundId: null,
      poseIds: {},
      lowerCatalogItemId: null,
      shoeCatalogItemId: null,
      upperGarmentKey: null,
      lowerGarmentKey: null,
      thirdGarmentKey: null,
      palluGarmentKey: null,
      posePresetPrefilled: false,
    );
    _autoSelectFirstFace(gender: state.gender, garmentType: garmentType);
    _autoSelectFirstBackground(gender: state.gender, garmentType: garmentType);
    _prefillPoses(gender: state.gender, garmentType: garmentType);
  }

  /// Every one of these `_autoSelectFirst*`/`_prefill*` methods runs as a
  /// plain async continuation — deliberately not driven by a widget's
  /// `ref.listen`, since mutating this controller's state from inside
  /// another widget's build (even via `Consumer`) can hit the ancestor
  /// `_CatalogueStudioFormState` mid-build and corrupt Flutter's layout
  /// dirty-tracking ("debugNeedsLayout is not true"). Each re-checks that
  /// the gender/garment type it was fetched for (and that nothing else beat
  /// it to a selection) is still current before applying anything, since
  /// the user can switch away before the fetch resolves.
  Future<void> _autoSelectFirstFace({
    required Gender gender,
    required GarmentType garmentType,
  }) async {
    try {
      final faces = await ref
          .read(studioRepositoryProvider)
          .faces(gender.apiValue);
      final stillRelevant =
          state.gender == gender &&
          state.garmentType?.id == garmentType.id &&
          state.faceId == null;
      if (faces.isNotEmpty && stillRelevant) {
        selectFace(faces.first.id);
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  /// Only meaningful in "Create Your Own" mode — Ready-Made's background
  /// comes from the chosen template's looks, not a standalone pick. Re-check
  /// at apply time (not just at call time) since the user can switch look
  /// modes while this fetch is in flight.
  Future<void> _autoSelectFirstBackground({
    required Gender gender,
    required GarmentType garmentType,
  }) async {
    try {
      final backgrounds = await ref
          .read(studioRepositoryProvider)
          .backgrounds(gender: gender.apiValue);
      final stillRelevant =
          state.gender == gender &&
          state.garmentType?.id == garmentType.id &&
          state.lookMode == LookMode.createYourOwn &&
          state.backgroundId == null &&
          state.selectedTemplate == null;
      if (backgrounds.isNotEmpty && stillRelevant) {
        selectBackground(backgrounds.first.id);
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  /// Selects the first available pose — same "default to first in the list"
  /// behavior as every other picker in this form.
  ///
  /// The account's last-used preset is deliberately not applied here. It
  /// used to be, silently: it could select several poses from an earlier
  /// session (on web too — the preset is per account), most of them
  /// scrolled out of view, and the generation then came back in poses the
  /// user never saw selected. The web studio only applies it when the
  /// "Last Used" chip is tapped, and so does this form now.
  Future<void> _prefillPoses({
    required Gender gender,
    required GarmentType garmentType,
  }) async {
    try {
      final poses = await ref
          .read(studioRepositoryProvider)
          .poses(gender: gender.apiValue, garmentTypeId: garmentType.id);
      final stillRelevant =
          state.gender == gender &&
          state.garmentType?.id == garmentType.id &&
          state.lookMode == LookMode.createYourOwn &&
          state.poseIds.isEmpty;
      if (poses.isNotEmpty && stillRelevant) {
        applyPosePreset({poses.first.id});
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  /// Only relevant once the user switches to Ready-Made — mirrors the other
  /// "default to first in the list" pickers, but only within that mode.
  Future<void> _autoSelectFirstTemplate({
    required Gender gender,
    required GarmentType garmentType,
  }) async {
    try {
      final templates = await ref
          .read(studioRepositoryProvider)
          .catalogueTemplates(
            gender: gender.apiValue,
            garmentTypeId: garmentType.id,
          );
      final stillRelevant =
          state.gender == gender &&
          state.garmentType?.id == garmentType.id &&
          state.lookMode == LookMode.readyMade &&
          state.selectedTemplate == null;
      if (templates.isNotEmpty && stillRelevant) {
        selectTemplate(templates.first);
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  /// Fallback for [_syncLowerShoeDefaults] when the garment type has no
  /// configured `defaultLowerCatalogId`/`defaultShoeCatalogId` — selects the
  /// first item from the actual catalog list instead of leaving it on
  /// "None". Must send the same `poseIds` the picker itself uses (see
  /// `GenderGarmentTypeAndPoses`'s doc comment) — without them this hits the
  /// server's legacy tree path, which for real accounts returns only the
  /// uncategorized 'other' bucket (filtered out below), so `first` is always
  /// null and no default ever gets picked.
  Future<void> _autoSelectFirstCatalogItem({
    required String catalogType,
    required GarmentType garmentType,
    required List<String> poseIds,
    required String? Function() currentSelection,
    required void Function(String id) select,
  }) async {
    try {
      final tree = await ref
          .read(studioRepositoryProvider)
          .catalogTree(
            type: catalogType,
            gender: state.gender.apiValue,
            garmentTypeId: garmentType.id,
            poseIds: poseIds.isEmpty ? null : poseIds,
          );
      final first = tree.tree
          .where((n) => n.slug != 'other')
          .expand(_flattenCatalogNode)
          .firstOrNull;
      final stillRelevant =
          state.garmentType?.id == garmentType.id && currentSelection() == null;
      if (first != null && stillRelevant) {
        select(first.id);
      }
    } catch (_) {
      // Nice-to-have default; the user can still pick manually.
    }
  }

  void setLookMode(LookMode mode) {
    state = state.copyWith(lookMode: mode);
    final garmentType = state.garmentType;
    if (mode == LookMode.readyMade && garmentType != null) {
      _autoSelectFirstTemplate(gender: state.gender, garmentType: garmentType);
    }
    _syncLowerShoeDefaults();
  }

  /// Forces "Create Your Own" when the current garment type turns out to
  /// have no ready-made templates — mirrors the web app's safety-net effect
  /// that resets away from template mode whenever the templates list can't
  /// back the current selection (studio/page.tsx's `catalogueTemplateId`
  /// reset effect). Called from the view via `ref.listen` on the templates
  /// provider once it resolves.
  void ensureCreateYourOwnIfNoTemplates() {
    if (state.lookMode == LookMode.readyMade) {
      state = state.copyWith(lookMode: LookMode.createYourOwn);
    }
  }

  /// Mirrors the web app's `needsLower`/`needsShoes` derivation exactly —
  /// `.some()` across selected poses (custom mode) or selected template
  /// looks (ready-made mode) — then keeps the catalog-item selection in
  /// sync with it: clears it the moment it's no longer needed, and applies
  /// the garment type's own `defaultLowerCatalogId`/`defaultShoeCatalogId`
  /// the moment it newly becomes needed and nothing is picked yet. Called
  /// after every mutation that can change which poses/looks are selected.
  void _syncLowerShoeDefaults() {
    final garmentType = state.garmentType;
    if (garmentType == null) return;

    final bool needsLower;
    final bool needsShoes;
    final List<String> effectivePoseIds;
    if (state.lookMode == LookMode.readyMade) {
      final looks = selectedLooks;
      needsLower = looks.any((l) => l.hasLower);
      needsShoes = looks.any((l) => l.hasShoes);
      effectivePoseIds = looks.map((l) => l.poseId).toList();
    } else {
      final poses =
          ref
              .read(
                posesProvider((
                  gender: state.gender,
                  garmentTypeId: garmentType.id,
                )),
              )
              .value ??
          const [];
      final selected = poses.where((p) => state.poseIds.contains(p.id));
      needsLower = selected.any((p) => p.hasLower);
      needsShoes = selected.any((p) => p.hasShoes);
      effectivePoseIds = state.poseIds.toList();
    }

    var lowerCatalogItemId = state.lowerCatalogItemId;
    var shoeCatalogItemId = state.shoeCatalogItemId;

    if (!needsLower) {
      lowerCatalogItemId = null;
    } else if (lowerCatalogItemId == null &&
        garmentType.defaultLowerCatalogId != null) {
      lowerCatalogItemId = garmentType.defaultLowerCatalogId;
    }

    if (!needsShoes) {
      shoeCatalogItemId = null;
    } else if (shoeCatalogItemId == null &&
        garmentType.defaultShoeCatalogId != null) {
      shoeCatalogItemId = garmentType.defaultShoeCatalogId;
    }

    if (lowerCatalogItemId != state.lowerCatalogItemId ||
        shoeCatalogItemId != state.shoeCatalogItemId) {
      state = state.copyWith(
        lowerCatalogItemId: lowerCatalogItemId,
        shoeCatalogItemId: shoeCatalogItemId,
      );
    }

    // No garment-type-configured default — fall back to the first item in
    // the actual catalog list, same as every other picker in this form.
    if (needsLower &&
        lowerCatalogItemId == null &&
        garmentType.defaultLowerCatalogId == null) {
      _autoSelectFirstCatalogItem(
        catalogType: 'lower',
        garmentType: garmentType,
        poseIds: effectivePoseIds,
        currentSelection: () => state.lowerCatalogItemId,
        select: selectLowerCatalogItem,
      );
    }
    if (needsShoes &&
        shoeCatalogItemId == null &&
        garmentType.defaultShoeCatalogId == null) {
      _autoSelectFirstCatalogItem(
        catalogType: 'shoe',
        garmentType: garmentType,
        poseIds: effectivePoseIds,
        currentSelection: () => state.shoeCatalogItemId,
        select: selectShoeCatalogItem,
      );
    }
  }

  Future<void> pickAndUploadUpper(File file) => _upload(
    file,
    onStart: () => state = state.copyWith(isUploadingUpper: true),
    onDone: (key) =>
        state = state.copyWith(isUploadingUpper: false, upperGarmentKey: key),
    onError: () => state = state.copyWith(isUploadingUpper: false),
  );

  Future<void> pickAndUploadLower(File file) => _upload(
    file,
    onStart: () => state = state.copyWith(isUploadingLower: true),
    onDone: (key) =>
        state = state.copyWith(isUploadingLower: false, lowerGarmentKey: key),
    onError: () => state = state.copyWith(isUploadingLower: false),
  );

  Future<void> pickAndUploadThird(File file) => _upload(
    file,
    onStart: () => state = state.copyWith(isUploadingThird: true),
    onDone: (key) =>
        state = state.copyWith(isUploadingThird: false, thirdGarmentKey: key),
    onError: () => state = state.copyWith(isUploadingThird: false),
  );

  Future<void> pickAndUploadPallu(File file) => _upload(
    file,
    onStart: () => state = state.copyWith(isUploadingPallu: true),
    onDone: (key) =>
        state = state.copyWith(isUploadingPallu: false, palluGarmentKey: key),
    onError: () => state = state.copyWith(isUploadingPallu: false),
  );

  Future<void> _upload(
    File file, {
    required void Function() onStart,
    required void Function(String key) onDone,
    required void Function() onError,
  }) async {
    onStart();
    try {
      final key = await ref
          .read(studioRepositoryProvider)
          .presignAndUpload(file);
      onDone(key);
    } on AppException catch (_) {
      onError();
    }
  }

  void removeUpperUpload() => state = state.copyWith(upperGarmentKey: null);
  void removeLowerUpload() => state = state.copyWith(lowerGarmentKey: null);
  void removeThirdUpload() => state = state.copyWith(thirdGarmentKey: null);
  void removePalluUpload() => state = state.copyWith(palluGarmentKey: null);

  /// Uploads (presign → PUT → confirm) a custom background and selects it —
  /// its returned `id` is used exactly like an admin-curated background's.
  Future<void> uploadCustomBackground(File file) async {
    state = state.copyWith(isUploadingBackground: true);
    try {
      final background = await ref
          .read(studioRepositoryProvider)
          .uploadCustomBackground(file);
      state = state.copyWith(
        isUploadingBackground: false,
        backgroundId: background.id,
        selectedTemplate: null,
      );
      ref.invalidate(myBackgroundsProvider);
    } on AppException catch (_) {
      state = state.copyWith(isUploadingBackground: false);
    }
  }

  /// Imports a background from an external image URL and selects it, the
  /// same way [uploadCustomBackground] does for a gallery photo.
  Future<void> addCustomBackgroundFromUrl(String url) async {
    state = state.copyWith(isUploadingBackground: true);
    try {
      final background = await ref
          .read(studioRepositoryProvider)
          .addCustomBackgroundFromUrl(url);
      state = state.copyWith(
        isUploadingBackground: false,
        backgroundId: background.id,
        selectedTemplate: null,
      );
      ref.invalidate(myBackgroundsProvider);
    } on AppException catch (_) {
      state = state.copyWith(isUploadingBackground: false);
    }
  }

  /// Removes one of the account's own backgrounds. Clears the current
  /// selection first if it pointed at the background being deleted, so the
  /// form never submits a `backgroundId` the picker no longer shows.
  Future<void> deleteCustomBackground(String id) async {
    if (state.backgroundId == id) {
      state = state.copyWith(backgroundId: null);
    }
    await ref.read(studioRepositoryProvider).deleteCustomBackground(id);
    ref.invalidate(myBackgroundsProvider);
  }

  /// Forgets every uploaded garment photo — called once a generation has
  /// been submitted, so coming back to the form starts from an empty upload
  /// area instead of the previous garment.
  void clearUploads() {
    state = state.copyWith(
      upperGarmentKey: null,
      lowerGarmentKey: null,
      thirdGarmentKey: null,
      palluGarmentKey: null,
    );
  }

  void selectFace(String faceId) => state = state.copyWith(faceId: faceId);

  /// The template's looks the user has kept selected (empty without a
  /// template).
  List<TemplateLook> get selectedLooks =>
      (state.selectedTemplate?.looks ?? const <TemplateLook>[])
          .where((l) => state.selectedLookIds.contains(l.id))
          .toList();

  /// All of a template's looks start selected — the user then deselects the
  /// ones they don't want (mirrors web's handleTemplateSelect).
  void selectTemplate(CatalogueTemplate template) {
    state = state.copyWith(
      selectedTemplate: template,
      selectedLookIds: template.looks.map((l) => l.id).toSet(),
    );
    _syncLowerShoeDefaults();
  }

  void toggleLook(String lookId) {
    final ids = {...state.selectedLookIds};
    if (!ids.remove(lookId)) ids.add(lookId);
    state = state.copyWith(selectedLookIds: ids);
    _syncLowerShoeDefaults();
  }

  void selectBackground(String backgroundId) => state = state.copyWith(
    backgroundId: backgroundId,
    selectedTemplate: null,
  );

  void togglePose(String poseId) {
    final poses = {...state.poseIds};
    if (!poses.remove(poseId)) poses.add(poseId);
    state = state.copyWith(poseIds: poses);
    _syncLowerShoeDefaults();
  }

  void selectLowerCatalogItem(String? id) =>
      state = state.copyWith(lowerCatalogItemId: id);
  void selectShoeCatalogItem(String? id) =>
      state = state.copyWith(shoeCatalogItemId: id);
  void selectPlatform(String platform) =>
      state = state.copyWith(platform: platform);
  void selectAspectRatio(String aspectRatio) =>
      state = state.copyWith(aspectRatio: aspectRatio);
  void selectResolution(String resolution) =>
      state = state.copyWith(resolution: resolution);

  /// Prefills the pose selection from the account's last-used preset for
  /// this gender+garment type, once per garment-type change.
  void applyLastUsedPreset(Set<String> poseIds) {
    if (state.posePresetPrefilled || poseIds.isEmpty) return;
    state = state.copyWith(poseIds: poseIds, posePresetPrefilled: true);
    _syncLowerShoeDefaults();
  }

  /// Applies a saved pose preset the user tapped explicitly — unlike
  /// [applyLastUsedPreset], always overwrites the current pose selection.
  void applyPosePreset(Set<String> poseIds) {
    state = state.copyWith(poseIds: poseIds, posePresetPrefilled: true);
    _syncLowerShoeDefaults();
  }

  Future<void> deletePosePreset(String id) =>
      ref.read(studioRepositoryProvider).deletePosePreset(id);

  Future<TryonSubmitResult> submit() async {
    final garmentType = state.garmentType;
    if (garmentType == null) {
      throw const AppException.badRequest('Choose a garment type first.');
    }
    if (state.upperGarmentKey == null) {
      throw const AppException.badRequest('Upload your garment photo first.');
    }
    if (state.faceId == null) {
      throw const AppException.badRequest('Choose a model first.');
    }
    if (garmentType.sareeTwoInputCapable && state.palluGarmentKey == null) {
      throw const AppException.badRequest('Upload the pallu image first.');
    }
    if (state.lookMode == LookMode.readyMade) {
      if (state.selectedTemplate == null || selectedLooks.isEmpty) {
        throw const AppException.badRequest('Choose a catalogue template.');
      }
    } else if (state.backgroundId == null || state.poseIds.isEmpty) {
      throw const AppException.badRequest(
        'Choose a background and at least one pose.',
      );
    }

    state = state.copyWith(isSubmitting: true, errorMessage: null);
    try {
      final repository = ref.read(studioRepositoryProvider);
      final inputs = _buildInputs(garmentType);
      // Mirrors the web app's own `effectivePlatform` (studio/page.tsx):
      // sending platform:'Amazon' literally makes the server try to swap in
      // an admin-configured white background (createJob's Amazon-override
      // branch) and throw "Amazon platform requires a white background to
      // be configured" if none is set up — which is exactly what happens on
      // this account. Web worked around it by never sending 'Amazon' at all
      // (its own amazonUseWhiteBg flag that would opt back in is
      // permanently false, "kept dormant for future use"); Android never
      // had that workaround, so every Amazon-platform generation here was
      // hitting this same dead validation.
      final effectivePlatform = state.platform == 'Amazon'
          ? null
          : state.platform;

      final result = garmentType.requiresMannequinStep
          ? await repository.submitSareeMannequin(
              garmentTypeId: garmentType.id,
              garmentKey: state.upperGarmentKey!,
              secondGarmentKey: garmentType.sareeTwoInputCapable
                  ? state.palluGarmentKey
                  : null,
              faceId: state.faceId!,
              // The server's step2 shape is `{ inputs: {...}, aspectRatio,
              // resolution, platform }` — `inputs` must be nested under its
              // own key, not spread flat into step2 alongside the output
              // fields. Sending it flat (as this did before) meant the
              // request had no `step2.inputs` key at all, which the server's
              // schema validation rejected as "body/step2/inputs Required".
              step2: {
                'inputs': Map<String, dynamic>.from(inputs)
                  ..remove('upperGarmentKey'),
                'aspectRatio': state.aspectRatio,
                'resolution': state.resolution,
                // Null-aware entry, not a plain `platform: null` — the
                // server's `platform` field is `z.string().optional()`,
                // which Zod rejects an explicit null for (only a genuinely
                // absent key is accepted).
                'platform': ?effectivePlatform,
              },
            )
          : await repository.submitTryon(
              inputs: inputs,
              aspectRatio: state.aspectRatio,
              resolution: state.resolution,
              platform: effectivePlatform,
            );

      state = state.copyWith(isSubmitting: false);
      ref.invalidate(creditsSummaryProvider);
      return result;
    } on AppException catch (e) {
      state = state.copyWith(isSubmitting: false, errorMessage: _messageOf(e));
      rethrow;
    }
  }

  Map<String, dynamic> _buildInputs(GarmentType garmentType) {
    // Decided by the mode the user is in, not by whether a template happens
    // to be set: switching from Ready-Made back to Create Your Own keeps the
    // last template in state, and keying on that sent the template's looks
    // instead of the poses and background on screen.
    final template = state.lookMode == LookMode.readyMade
        ? state.selectedTemplate
        : null;
    return {
      'upperGarmentKey': state.upperGarmentKey,
      'faceId': state.faceId,
      if (template != null)
        'looks': selectedLooks
            .map((l) => {'poseId': l.poseId, 'backgroundId': l.backgroundId})
            .toList()
      else ...{
        'backgroundId': state.backgroundId,
        'poseIds': state.poseIds.toList(),
      },
      'garmentTypeId': garmentType.id,
      'catalogueTemplateMappingId': ?template?.mappingId,
      'lowerCatalogId': ?state.lowerCatalogItemId,
      'lowerGarmentKey': ?state.lowerGarmentKey,
      'thirdGarmentKey': ?state.thirdGarmentKey,
      'shoeCatalogId': ?state.shoeCatalogItemId,
    };
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
}

final catalogueSelectionControllerProvider =
    NotifierProvider<CatalogueSelectionController, CatalogueSelectionState>(
      CatalogueSelectionController.new,
    );

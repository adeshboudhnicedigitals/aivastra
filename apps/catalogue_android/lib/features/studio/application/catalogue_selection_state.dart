import 'package:freezed_annotation/freezed_annotation.dart';

import '../data/models/catalogue_template.dart';
import '../data/models/garment_type.dart';
import '../data/models/gender.dart';

part 'catalogue_selection_state.freezed.dart';

enum LookMode { readyMade, createYourOwn }

@freezed
abstract class CatalogueSelectionState with _$CatalogueSelectionState {
  const factory CatalogueSelectionState({
    @Default(Gender.women) Gender gender,
    GarmentType? garmentType,
    String? upperGarmentKey,
    String? lowerGarmentKey,
    String? thirdGarmentKey,
    // The Saree "Body & Pallu" mannequin-step second photo — deliberately a
    // separate field from thirdGarmentKey/requiresThirdUpload, which is an
    // unrelated mechanism for the plain (non-mannequin) tryon flow. Active
    // whenever the garment type is mannequin-step AND has
    // mannequinTwoInputWorkflowTemplateId set — mirrors the web app's
    // sareeTwoInputCapable/palluGarmentKey (apps/catalogues-web's studio page).
    String? palluGarmentKey,
    @Default(false) bool isUploadingUpper,
    @Default(false) bool isUploadingLower,
    @Default(false) bool isUploadingThird,
    @Default(false) bool isUploadingPallu,
    @Default(false) bool isUploadingBackground,
    // The web app always starts on 'custom' (createYourOwn) regardless of
    // garment type — Ready-Made is a pure opt-in the user reaches by tapping
    // a template card, never a default, and is hidden entirely when a
    // garment type has zero templates (see catalogueTemplatesProvider gating
    // in catalogue_studio_form.dart).
    @Default(LookMode.createYourOwn) LookMode lookMode,
    String? faceId,
    CatalogueTemplate? selectedTemplate,
    // Which of [selectedTemplate]'s looks (poses) the user has kept — all of
    // them right after picking a template, then toggled one by one (single or
    // multiple), exactly like the web app's selectedLookIds.
    @Default(<String>{}) Set<String> selectedLookIds,
    String? backgroundId,
    @Default(<String>{}) Set<String> poseIds,
    String? lowerCatalogItemId,
    String? shoeCatalogItemId,
    @Default('Amazon') String platform,
    @Default('1:1') String aspectRatio,
    // 'HD' is disabled by default server-side (DEFAULT_RESOLUTION_CONFIG in
    // apps/api/src/lib/resolution-config.ts) — only '2K'/'4K' are normally
    // enabled, so defaulting here to a tier that's actually offered avoids
    // submitting a resolution the picker never let the user select.
    @Default('2K') String resolution,
    @Default(false) bool posePresetPrefilled,
    @Default(false) bool isSubmitting,
    String? errorMessage,
  }) = _CatalogueSelectionState;
}

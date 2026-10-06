import 'package:freezed_annotation/freezed_annotation.dart';

part 'garment_type.freezed.dart';
part 'garment_type.g.dart';

@freezed
abstract class GarmentType with _$GarmentType {
  const factory GarmentType({
    required String id,
    required String slug,
    required String label,
    required int sortOrder,
    String? thumbnailUrl,
    String? instructionImageUrl,
    String? tutorialVideoUrl,
    @Default(false) bool requiresLowerUpload,
    String? upperUploadLabel,
    String? lowerUploadLabel,
    @Default(false) bool requiresThirdUpload,
    String? thirdUploadLabel,
    String? defaultLowerCatalogId,
    String? defaultShoeCatalogId,
    @Default(false) bool requiresMannequinStep,
    String? mannequinTwoInputWorkflowTemplateId,
  }) = _GarmentType;

  factory GarmentType.fromJson(Map<String, dynamic> json) =>
      _$GarmentTypeFromJson(json);
}

extension GarmentTypeSareeTwoInput on GarmentType {
  /// Mirrors the web app's `sareeTwoInputCapable` (studio page): a
  /// mannequin-step garment type (e.g. plain "Saree") with a two-input
  /// workflow configured always shows Body + Pallu uploads instead of one —
  /// unrelated to [requiresThirdUpload], which is a separate mechanism for
  /// the non-mannequin tryon flow.
  bool get sareeTwoInputCapable =>
      requiresMannequinStep && mannequinTwoInputWorkflowTemplateId != null;
}

/// Slug/label keywords identifying a garment type whose single upload IS a
/// bottom-wear item (Jean, Trouser, Skirt, ...). There is no admin-curated
/// flag for this anywhere in the schema — `requiresLowerUpload` means
/// something different (a *second*, directly-uploaded lower photo alongside
/// the main one, e.g. Kurti & Pyjama) — so the web app has no equivalent
/// suppression either and shows the same redundant "Lower Garment" catalog
/// picker it would show here, whenever the selected pose's `hasLower` flag
/// is on (a pose/garment-type combination decided by admin data in
/// `pose_garment_configs`, not by this list). This keyword match is a
/// deliberate, Android-only UX fix on top of that: extend it if a new
/// bottom-wear-only garment type is added and shows the same redundancy.
const _bottomWearOnlyKeywords = [
  'jean',
  'trouser',
  'track',
  'jogger',
  'skirt',
  'legging',
  'short',
  'palazzo',
  'dhoti',
  'lungi',
  'culotte',
  'pant',
];

extension GarmentTypeBottomWearOnly on GarmentType {
  /// True when this garment type's single upload already covers the lower
  /// body (e.g. Jean, Trouser, Skirt) — see [_bottomWearOnlyKeywords]. Only
  /// suppresses the Lower Garment catalog picker; Footwear stays independent
  /// since choosing shoes to complete the look is still meaningful.
  bool get isBottomWearOnly {
    final haystack = '$slug $label'.toLowerCase();
    return _bottomWearOnlyKeywords.any(haystack.contains);
  }
}

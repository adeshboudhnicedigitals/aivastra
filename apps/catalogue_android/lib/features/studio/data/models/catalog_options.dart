import 'package:freezed_annotation/freezed_annotation.dart';

part 'catalog_options.freezed.dart';
part 'catalog_options.g.dart';

/// A lightweight item returned by the `/v1/dev/catalog/options` endpoint.
/// Uses [slug] as the identifier (instead of a numeric id).
@freezed
abstract class CatalogOptionItem with _$CatalogOptionItem {
  const factory CatalogOptionItem({
    required String slug,
    required String label,
    String? thumbnailUrl,
  }) = _CatalogOptionItem;

  factory CatalogOptionItem.fromJson(Map<String, dynamic> json) =>
      _$CatalogOptionItemFromJson(json);
}

/// Garment-type entry from `/v1/dev/catalog/options`.
@freezed
abstract class CatalogOptionGarmentType with _$CatalogOptionGarmentType {
  const factory CatalogOptionGarmentType({
    required String slug,
    required String label,
    @Default(false) bool requiresLowerUpload,
    String? lowerUploadLabel,
    @Default(false) bool requiresThirdUpload,
    String? thirdUploadLabel,
  }) = _CatalogOptionGarmentType;

  factory CatalogOptionGarmentType.fromJson(Map<String, dynamic> json) =>
      _$CatalogOptionGarmentTypeFromJson(json);
}

/// Pose entry from `/v1/dev/catalog/options` — includes `hasLower` / `hasShoes`.
@freezed
abstract class CatalogOptionPose with _$CatalogOptionPose {
  const factory CatalogOptionPose({
    required String slug,
    required String label,
    required String thumbnailUrl,
    @Default(false) bool hasLower,
    @Default(false) bool hasShoes,
  }) = _CatalogOptionPose;

  factory CatalogOptionPose.fromJson(Map<String, dynamic> json) =>
      _$CatalogOptionPoseFromJson(json);
}

/// Unified response from `GET /v1/dev/catalog/options`.
@freezed
abstract class CatalogOptions with _$CatalogOptions {
  const factory CatalogOptions({
    @Default([]) List<CatalogOptionGarmentType> garmentTypes,
    @Default([]) List<CatalogOptionItem> faces,
    @Default([]) List<CatalogOptionItem> backgrounds,
    @Default([]) List<CatalogOptionPose> poses,
    @Default([]) List<CatalogOptionItem> lowerItems,
    @Default([]) List<CatalogOptionItem> shoeItems,
  }) = _CatalogOptions;

  factory CatalogOptions.fromJson(Map<String, dynamic> json) =>
      _$CatalogOptionsFromJson(json);
}

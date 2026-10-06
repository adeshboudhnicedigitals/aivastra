// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_options.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CatalogOptionItem _$CatalogOptionItemFromJson(Map<String, dynamic> json) =>
    _CatalogOptionItem(
      slug: json['slug'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );

Map<String, dynamic> _$CatalogOptionItemToJson(_CatalogOptionItem instance) =>
    <String, dynamic>{
      'slug': instance.slug,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
    };

_CatalogOptionGarmentType _$CatalogOptionGarmentTypeFromJson(
  Map<String, dynamic> json,
) => _CatalogOptionGarmentType(
  slug: json['slug'] as String,
  label: json['label'] as String,
  requiresLowerUpload: json['requiresLowerUpload'] as bool? ?? false,
  lowerUploadLabel: json['lowerUploadLabel'] as String?,
  requiresThirdUpload: json['requiresThirdUpload'] as bool? ?? false,
  thirdUploadLabel: json['thirdUploadLabel'] as String?,
);

Map<String, dynamic> _$CatalogOptionGarmentTypeToJson(
  _CatalogOptionGarmentType instance,
) => <String, dynamic>{
  'slug': instance.slug,
  'label': instance.label,
  'requiresLowerUpload': instance.requiresLowerUpload,
  'lowerUploadLabel': instance.lowerUploadLabel,
  'requiresThirdUpload': instance.requiresThirdUpload,
  'thirdUploadLabel': instance.thirdUploadLabel,
};

_CatalogOptionPose _$CatalogOptionPoseFromJson(Map<String, dynamic> json) =>
    _CatalogOptionPose(
      slug: json['slug'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String,
      hasLower: json['hasLower'] as bool? ?? false,
      hasShoes: json['hasShoes'] as bool? ?? false,
    );

Map<String, dynamic> _$CatalogOptionPoseToJson(_CatalogOptionPose instance) =>
    <String, dynamic>{
      'slug': instance.slug,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'hasLower': instance.hasLower,
      'hasShoes': instance.hasShoes,
    };

_CatalogOptions _$CatalogOptionsFromJson(
  Map<String, dynamic> json,
) => _CatalogOptions(
  garmentTypes:
      (json['garmentTypes'] as List<dynamic>?)
          ?.map(
            (e) => CatalogOptionGarmentType.fromJson(e as Map<String, dynamic>),
          )
          .toList() ??
      const [],
  faces:
      (json['faces'] as List<dynamic>?)
          ?.map((e) => CatalogOptionItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  backgrounds:
      (json['backgrounds'] as List<dynamic>?)
          ?.map((e) => CatalogOptionItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  poses:
      (json['poses'] as List<dynamic>?)
          ?.map((e) => CatalogOptionPose.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  lowerItems:
      (json['lowerItems'] as List<dynamic>?)
          ?.map((e) => CatalogOptionItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  shoeItems:
      (json['shoeItems'] as List<dynamic>?)
          ?.map((e) => CatalogOptionItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$CatalogOptionsToJson(_CatalogOptions instance) =>
    <String, dynamic>{
      'garmentTypes': instance.garmentTypes,
      'faces': instance.faces,
      'backgrounds': instance.backgrounds,
      'poses': instance.poses,
      'lowerItems': instance.lowerItems,
      'shoeItems': instance.shoeItems,
    };

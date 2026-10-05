// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'garment_type.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_GarmentType _$GarmentTypeFromJson(Map<String, dynamic> json) => _GarmentType(
  id: json['id'] as String,
  slug: json['slug'] as String,
  label: json['label'] as String,
  sortOrder: (json['sortOrder'] as num).toInt(),
  thumbnailUrl: json['thumbnailUrl'] as String?,
  instructionImageUrl: json['instructionImageUrl'] as String?,
  tutorialVideoUrl: json['tutorialVideoUrl'] as String?,
  requiresLowerUpload: json['requiresLowerUpload'] as bool? ?? false,
  upperUploadLabel: json['upperUploadLabel'] as String?,
  lowerUploadLabel: json['lowerUploadLabel'] as String?,
  requiresThirdUpload: json['requiresThirdUpload'] as bool? ?? false,
  thirdUploadLabel: json['thirdUploadLabel'] as String?,
  defaultLowerCatalogId: json['defaultLowerCatalogId'] as String?,
  defaultShoeCatalogId: json['defaultShoeCatalogId'] as String?,
  requiresMannequinStep: json['requiresMannequinStep'] as bool? ?? false,
  mannequinTwoInputWorkflowTemplateId:
      json['mannequinTwoInputWorkflowTemplateId'] as String?,
);

Map<String, dynamic> _$GarmentTypeToJson(_GarmentType instance) =>
    <String, dynamic>{
      'id': instance.id,
      'slug': instance.slug,
      'label': instance.label,
      'sortOrder': instance.sortOrder,
      'thumbnailUrl': instance.thumbnailUrl,
      'instructionImageUrl': instance.instructionImageUrl,
      'tutorialVideoUrl': instance.tutorialVideoUrl,
      'requiresLowerUpload': instance.requiresLowerUpload,
      'upperUploadLabel': instance.upperUploadLabel,
      'lowerUploadLabel': instance.lowerUploadLabel,
      'requiresThirdUpload': instance.requiresThirdUpload,
      'thirdUploadLabel': instance.thirdUploadLabel,
      'defaultLowerCatalogId': instance.defaultLowerCatalogId,
      'defaultShoeCatalogId': instance.defaultShoeCatalogId,
      'requiresMannequinStep': instance.requiresMannequinStep,
      'mannequinTwoInputWorkflowTemplateId':
          instance.mannequinTwoInputWorkflowTemplateId,
    };

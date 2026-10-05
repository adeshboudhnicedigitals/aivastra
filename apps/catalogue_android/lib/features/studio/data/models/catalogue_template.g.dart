// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalogue_template.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_TemplateLook _$TemplateLookFromJson(Map<String, dynamic> json) =>
    _TemplateLook(
      id: json['id'] as String,
      poseId: json['poseId'] as String,
      poseLabel: json['poseLabel'] as String,
      poseThumbnailUrl: json['poseThumbnailUrl'] as String,
      backgroundId: json['backgroundId'] as String,
      backgroundLabel: json['backgroundLabel'] as String,
      backgroundThumbnailUrl: json['backgroundThumbnailUrl'] as String,
      hasLower: json['hasLower'] as bool? ?? false,
      hasShoes: json['hasShoes'] as bool? ?? false,
    );

Map<String, dynamic> _$TemplateLookToJson(_TemplateLook instance) =>
    <String, dynamic>{
      'id': instance.id,
      'poseId': instance.poseId,
      'poseLabel': instance.poseLabel,
      'poseThumbnailUrl': instance.poseThumbnailUrl,
      'backgroundId': instance.backgroundId,
      'backgroundLabel': instance.backgroundLabel,
      'backgroundThumbnailUrl': instance.backgroundThumbnailUrl,
      'hasLower': instance.hasLower,
      'hasShoes': instance.hasShoes,
    };

_CatalogueTemplate _$CatalogueTemplateFromJson(Map<String, dynamic> json) =>
    _CatalogueTemplate(
      id: json['id'] as String,
      mappingId: json['mappingId'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      looks: (json['looks'] as List<dynamic>)
          .map((e) => TemplateLook.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$CatalogueTemplateToJson(_CatalogueTemplate instance) =>
    <String, dynamic>{
      'id': instance.id,
      'mappingId': instance.mappingId,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'looks': instance.looks,
    };

// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'background_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_BackgroundModel _$BackgroundModelFromJson(Map<String, dynamic> json) =>
    _BackgroundModel(
      id: json['id'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String,
      previewUrl: json['previewUrl'] as String,
      isWhiteBg: json['isWhiteBg'] as bool? ?? false,
      categoryId: (json['categoryId'] as num?)?.toInt(),
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
      specialTag: json['specialTag'] as String?,
    );

Map<String, dynamic> _$BackgroundModelToJson(_BackgroundModel instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'previewUrl': instance.previewUrl,
      'isWhiteBg': instance.isWhiteBg,
      'categoryId': instance.categoryId,
      'tags': instance.tags,
      'specialTag': instance.specialTag,
    };

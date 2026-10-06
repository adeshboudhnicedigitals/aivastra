// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'background_category.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_BackgroundCategory _$BackgroundCategoryFromJson(Map<String, dynamic> json) =>
    _BackgroundCategory(
      id: (json['id'] as num).toInt(),
      slug: json['slug'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );

Map<String, dynamic> _$BackgroundCategoryToJson(_BackgroundCategory instance) =>
    <String, dynamic>{
      'id': instance.id,
      'slug': instance.slug,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
    };

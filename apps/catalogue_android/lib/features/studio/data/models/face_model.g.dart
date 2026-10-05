// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'face_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_FaceModel _$FaceModelFromJson(Map<String, dynamic> json) => _FaceModel(
  id: json['id'] as String,
  gender: json['gender'] as String,
  label: json['label'] as String,
  continent: json['continent'] as String?,
  thumbnailUrl: json['thumbnailUrl'] as String,
  tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
);

Map<String, dynamic> _$FaceModelToJson(_FaceModel instance) =>
    <String, dynamic>{
      'id': instance.id,
      'gender': instance.gender,
      'label': instance.label,
      'continent': instance.continent,
      'thumbnailUrl': instance.thumbnailUrl,
      'tags': instance.tags,
    };

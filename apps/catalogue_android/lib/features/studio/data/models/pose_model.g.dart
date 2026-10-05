// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pose_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_PoseModel _$PoseModelFromJson(Map<String, dynamic> json) => _PoseModel(
  id: json['id'] as String,
  label: json['label'] as String,
  thumbnailUrl: json['thumbnailUrl'] as String,
  hasLower: json['hasLower'] as bool? ?? false,
  hasShoes: json['hasShoes'] as bool? ?? false,
  hasAspectRatio: json['hasAspectRatio'] as bool? ?? false,
);

Map<String, dynamic> _$PoseModelToJson(_PoseModel instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'hasLower': instance.hasLower,
      'hasShoes': instance.hasShoes,
      'hasAspectRatio': instance.hasAspectRatio,
    };

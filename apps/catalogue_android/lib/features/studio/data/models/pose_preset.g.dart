// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pose_preset.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_PosePreset _$PosePresetFromJson(Map<String, dynamic> json) => _PosePreset(
  id: json['id'] as String,
  name: json['name'] as String,
  gender: json['gender'] as String,
  garmentTypeId: json['garmentTypeId'] as String,
  poseIds: (json['poseIds'] as List<dynamic>).map((e) => e as String).toList(),
  isLastUsed: json['isLastUsed'] as bool? ?? false,
  updatedAt: json['updatedAt'] as String,
);

Map<String, dynamic> _$PosePresetToJson(_PosePreset instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'gender': instance.gender,
      'garmentTypeId': instance.garmentTypeId,
      'poseIds': instance.poseIds,
      'isLastUsed': instance.isLastUsed,
      'updatedAt': instance.updatedAt,
    };

_PosePresetsResponse _$PosePresetsResponseFromJson(Map<String, dynamic> json) =>
    _PosePresetsResponse(
      lastUsed: json['lastUsed'] == null
          ? null
          : PosePreset.fromJson(json['lastUsed'] as Map<String, dynamic>),
      named: (json['named'] as List<dynamic>)
          .map((e) => PosePreset.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$PosePresetsResponseToJson(
  _PosePresetsResponse instance,
) => <String, dynamic>{'lastUsed': instance.lastUsed, 'named': instance.named};

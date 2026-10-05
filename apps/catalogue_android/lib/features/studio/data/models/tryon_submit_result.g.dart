// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tryon_submit_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_TryonSubmitResult _$TryonSubmitResultFromJson(Map<String, dynamic> json) =>
    _TryonSubmitResult(
      catalogueId: json['catalogueId'] as String,
      jobIds: (json['jobIds'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      poseIds: (json['poseIds'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      gender: json['gender'] as String?,
      garmentTypeId: json['garmentTypeId'] as String?,
    );

Map<String, dynamic> _$TryonSubmitResultToJson(_TryonSubmitResult instance) =>
    <String, dynamic>{
      'catalogueId': instance.catalogueId,
      'jobIds': instance.jobIds,
      'poseIds': instance.poseIds,
      'gender': instance.gender,
      'garmentTypeId': instance.garmentTypeId,
    };

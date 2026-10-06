// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalogue_detail.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CatalogueDetail _$CatalogueDetailFromJson(Map<String, dynamic> json) =>
    _CatalogueDetail(
      catalogueId: json['catalogueId'] as String,
      jobs:
          (json['jobs'] as List<dynamic>?)
              ?.map((e) => JobRow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      aspectRatio: json['aspectRatio'] as String?,
      platform: json['platform'] as String?,
      garmentUrl: json['garmentUrl'] as String?,
      currentPlanWatermark: json['currentPlanWatermark'] as bool?,
      gender: json['gender'] as String?,
      garmentName: json['garmentName'] as String?,
    );

Map<String, dynamic> _$CatalogueDetailToJson(_CatalogueDetail instance) =>
    <String, dynamic>{
      'catalogueId': instance.catalogueId,
      'jobs': instance.jobs,
      'aspectRatio': instance.aspectRatio,
      'platform': instance.platform,
      'garmentUrl': instance.garmentUrl,
      'currentPlanWatermark': instance.currentPlanWatermark,
      'gender': instance.gender,
      'garmentName': instance.garmentName,
    };

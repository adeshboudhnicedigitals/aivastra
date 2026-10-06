// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalogue_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CatalogueSummary _$CatalogueSummaryFromJson(Map<String, dynamic> json) =>
    _CatalogueSummary(
      catalogueId: json['catalogueId'] as String,
      genderSlug: json['genderSlug'] as String?,
      platform: json['platform'] as String?,
      garmentType: json['garmentType'] as String?,
      jobs:
          (json['jobs'] as List<dynamic>?)
              ?.map((e) => JobRow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      createdAt: json['createdAt'] as String,
      coverUrl: json['coverUrl'] as String?,
      coverThumbUrl: json['coverThumbUrl'] as String?,
    );

Map<String, dynamic> _$CatalogueSummaryToJson(_CatalogueSummary instance) =>
    <String, dynamic>{
      'catalogueId': instance.catalogueId,
      'genderSlug': instance.genderSlug,
      'platform': instance.platform,
      'garmentType': instance.garmentType,
      'jobs': instance.jobs,
      'createdAt': instance.createdAt,
      'coverUrl': instance.coverUrl,
      'coverThumbUrl': instance.coverThumbUrl,
    };

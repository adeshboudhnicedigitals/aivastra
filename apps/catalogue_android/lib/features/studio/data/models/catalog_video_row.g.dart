// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_video_row.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CatalogVideoRow _$CatalogVideoRowFromJson(Map<String, dynamic> json) =>
    _CatalogVideoRow(
      id: json['id'] as String,
      status: json['status'] as String,
      createdAt: json['createdAt'] as String,
      sampleVideoId: json['sampleVideoId'] as String?,
      videoUrl: json['videoUrl'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      duration: (json['duration'] as num?)?.toInt(),
    );

Map<String, dynamic> _$CatalogVideoRowToJson(_CatalogVideoRow instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'createdAt': instance.createdAt,
      'sampleVideoId': instance.sampleVideoId,
      'videoUrl': instance.videoUrl,
      'thumbnailUrl': instance.thumbnailUrl,
      'duration': instance.duration,
    };

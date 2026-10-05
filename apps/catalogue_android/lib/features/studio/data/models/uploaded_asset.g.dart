// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'uploaded_asset.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_UploadedAsset _$UploadedAssetFromJson(Map<String, dynamic> json) =>
    _UploadedAsset(
      r2Key: json['r2Key'] as String,
      uploadedAt: json['uploadedAt'] as String,
      jobsCount: (json['jobsCount'] as num).toInt(),
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );

Map<String, dynamic> _$UploadedAssetToJson(_UploadedAsset instance) =>
    <String, dynamic>{
      'r2Key': instance.r2Key,
      'uploadedAt': instance.uploadedAt,
      'jobsCount': instance.jobsCount,
      'thumbnailUrl': instance.thumbnailUrl,
    };

// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'job_row.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_JobRow _$JobRowFromJson(Map<String, dynamic> json) => _JobRow(
  id: json['id'] as String,
  status: json['status'] as String,
  createdAt: json['createdAt'] as String,
  completedAt: json['completedAt'] as String?,
  errorMessage: json['errorMessage'] as String?,
  assetKind: json['assetKind'] as String?,
  watermarkVersion: (json['watermarkVersion'] as num?)?.toInt(),
  alreadyDownloaded: json['alreadyDownloaded'] as bool?,
  creditsCharged: (json['creditsCharged'] as num?)?.toInt(),
);

Map<String, dynamic> _$JobRowToJson(_JobRow instance) => <String, dynamic>{
  'id': instance.id,
  'status': instance.status,
  'createdAt': instance.createdAt,
  'completedAt': instance.completedAt,
  'errorMessage': instance.errorMessage,
  'assetKind': instance.assetKind,
  'watermarkVersion': instance.watermarkVersion,
  'alreadyDownloaded': instance.alreadyDownloaded,
  'creditsCharged': instance.creditsCharged,
};

_PresignedUrl _$PresignedUrlFromJson(Map<String, dynamic> json) =>
    _PresignedUrl(
      url: json['url'] as String,
      expiresIn: (json['expiresIn'] as num).toInt(),
    );

Map<String, dynamic> _$PresignedUrlToJson(_PresignedUrl instance) =>
    <String, dynamic>{'url': instance.url, 'expiresIn': instance.expiresIn};

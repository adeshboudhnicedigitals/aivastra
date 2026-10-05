// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'custom_background.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CustomBackground _$CustomBackgroundFromJson(Map<String, dynamic> json) =>
    _CustomBackground(
      id: json['id'] as String,
      label: json['label'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String,
    );

Map<String, dynamic> _$CustomBackgroundToJson(_CustomBackground instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
    };

_BackgroundUploadPresign _$BackgroundUploadPresignFromJson(
  Map<String, dynamic> json,
) => _BackgroundUploadPresign(
  uploadUrl: json['uploadUrl'] as String,
  r2Key: json['r2Key'] as String,
  id: json['id'] as String,
  expiresIn: (json['expiresIn'] as num).toInt(),
);

Map<String, dynamic> _$BackgroundUploadPresignToJson(
  _BackgroundUploadPresign instance,
) => <String, dynamic>{
  'uploadUrl': instance.uploadUrl,
  'r2Key': instance.r2Key,
  'id': instance.id,
  'expiresIn': instance.expiresIn,
};

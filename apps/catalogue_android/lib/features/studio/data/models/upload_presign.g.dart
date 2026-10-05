// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'upload_presign.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_UploadPresign _$UploadPresignFromJson(Map<String, dynamic> json) =>
    _UploadPresign(
      uploadUrl: json['uploadUrl'] as String,
      r2Key: json['r2Key'] as String,
      expiresIn: (json['expiresIn'] as num).toInt(),
    );

Map<String, dynamic> _$UploadPresignToJson(_UploadPresign instance) =>
    <String, dynamic>{
      'uploadUrl': instance.uploadUrl,
      'r2Key': instance.r2Key,
      'expiresIn': instance.expiresIn,
    };

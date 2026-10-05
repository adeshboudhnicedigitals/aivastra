// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'active_device_info.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_ActiveDeviceInfo _$ActiveDeviceInfoFromJson(Map<String, dynamic> json) =>
    _ActiveDeviceInfo(
      id: json['id'] as String,
      platform: json['platform'] as String,
      deviceId: json['deviceId'] as String,
      deviceName: json['deviceName'] as String?,
      createdAt: json['createdAt'] as String,
      expiresAt: json['expiresAt'] as String,
    );

Map<String, dynamic> _$ActiveDeviceInfoToJson(_ActiveDeviceInfo instance) =>
    <String, dynamic>{
      'id': instance.id,
      'platform': instance.platform,
      'deviceId': instance.deviceId,
      'deviceName': instance.deviceName,
      'createdAt': instance.createdAt,
      'expiresAt': instance.expiresAt,
    };

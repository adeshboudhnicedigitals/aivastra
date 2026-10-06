// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_user.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_AppUser _$AppUserFromJson(Map<String, dynamic> json) => _AppUser(
  id: json['id'] as String,
  email: json['email'] as String?,
  displayName: json['displayName'] as String?,
  tier: json['tier'] as String,
  maxActiveDevices: (json['maxActiveDevices'] as num).toInt(),
);

Map<String, dynamic> _$AppUserToJson(_AppUser instance) => <String, dynamic>{
  'id': instance.id,
  'email': instance.email,
  'displayName': instance.displayName,
  'tier': instance.tier,
  'maxActiveDevices': instance.maxActiveDevices,
};

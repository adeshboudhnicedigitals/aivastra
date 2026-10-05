// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_profile.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_MeProfile _$MeProfileFromJson(Map<String, dynamic> json) => _MeProfile(
  id: json['id'] as String,
  email: json['email'] as String?,
  displayName: json['displayName'] as String?,
  phone: json['phone'] as String?,
  username: json['username'] as String?,
  companyName: json['companyName'] as String?,
  gstin: json['gstin'] as String?,
  tier: json['tier'] as String,
  defaultResolution: json['defaultResolution'] as String?,
  defaultAspectRatio: json['defaultAspectRatio'] as String?,
  defaultPlatform: json['defaultPlatform'] as String?,
  hasPassword: json['hasPassword'] as bool,
  hasShopifyStore: json['hasShopifyStore'] as bool,
  isMerchant: json['isMerchant'] as bool,
  catalogVideoEnabled: json['catalogVideoEnabled'] as bool,
);

Map<String, dynamic> _$MeProfileToJson(_MeProfile instance) =>
    <String, dynamic>{
      'id': instance.id,
      'email': instance.email,
      'displayName': instance.displayName,
      'phone': instance.phone,
      'username': instance.username,
      'companyName': instance.companyName,
      'gstin': instance.gstin,
      'tier': instance.tier,
      'defaultResolution': instance.defaultResolution,
      'defaultAspectRatio': instance.defaultAspectRatio,
      'defaultPlatform': instance.defaultPlatform,
      'hasPassword': instance.hasPassword,
      'hasShopifyStore': instance.hasShopifyStore,
      'isMerchant': instance.isMerchant,
      'catalogVideoEnabled': instance.catalogVideoEnabled,
    };

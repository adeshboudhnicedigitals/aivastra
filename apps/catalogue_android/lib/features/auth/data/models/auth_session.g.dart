// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_AuthSession _$AuthSessionFromJson(Map<String, dynamic> json) => _AuthSession(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
  user: AppUser.fromJson(json['user'] as Map<String, dynamic>),
  logoUrl: json['logoUrl'] as String?,
  loadingVideoUrl: json['loadingVideoUrl'] as String?,
  merchantStatus: json['merchantStatus'] as String,
  onboarding: json['onboarding'] == null
      ? null
      : OnboardingPrefill.fromJson(json['onboarding'] as Map<String, dynamic>),
);

Map<String, dynamic> _$AuthSessionToJson(_AuthSession instance) =>
    <String, dynamic>{
      'accessToken': instance.accessToken,
      'refreshToken': instance.refreshToken,
      'user': instance.user,
      'logoUrl': instance.logoUrl,
      'loadingVideoUrl': instance.loadingVideoUrl,
      'merchantStatus': instance.merchantStatus,
      'onboarding': instance.onboarding,
    };

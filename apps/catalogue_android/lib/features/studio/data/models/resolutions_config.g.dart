// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'resolutions_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_ResolutionInfo _$ResolutionInfoFromJson(Map<String, dynamic> json) =>
    _ResolutionInfo(
      enabled: json['enabled'] as bool,
      creditCost: (json['creditCost'] as num).toInt(),
      longEdgePx: (json['longEdgePx'] as num).toInt(),
    );

Map<String, dynamic> _$ResolutionInfoToJson(_ResolutionInfo instance) =>
    <String, dynamic>{
      'enabled': instance.enabled,
      'creditCost': instance.creditCost,
      'longEdgePx': instance.longEdgePx,
    };

_ResolutionsConfig _$ResolutionsConfigFromJson(Map<String, dynamic> json) =>
    _ResolutionsConfig(
      resolutions: (json['resolutions'] as Map<String, dynamic>).map(
        (k, e) =>
            MapEntry(k, ResolutionInfo.fromJson(e as Map<String, dynamic>)),
      ),
    );

Map<String, dynamic> _$ResolutionsConfigToJson(_ResolutionsConfig instance) =>
    <String, dynamic>{'resolutions': instance.resolutions};

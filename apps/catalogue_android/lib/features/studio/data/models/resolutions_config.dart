import 'package:freezed_annotation/freezed_annotation.dart';

part 'resolutions_config.freezed.dart';
part 'resolutions_config.g.dart';

@freezed
abstract class ResolutionInfo with _$ResolutionInfo {
  const factory ResolutionInfo({
    required bool enabled,
    required int creditCost,
    required int longEdgePx,
  }) = _ResolutionInfo;

  factory ResolutionInfo.fromJson(Map<String, dynamic> json) =>
      _$ResolutionInfoFromJson(json);
}

@freezed
abstract class ResolutionsConfig with _$ResolutionsConfig {
  const factory ResolutionsConfig({
    required Map<String, ResolutionInfo> resolutions,
  }) = _ResolutionsConfig;

  factory ResolutionsConfig.fromJson(Map<String, dynamic> json) =>
      _$ResolutionsConfigFromJson(json);
}

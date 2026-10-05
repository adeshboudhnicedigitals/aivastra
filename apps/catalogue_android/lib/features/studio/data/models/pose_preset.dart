import 'package:freezed_annotation/freezed_annotation.dart';

part 'pose_preset.freezed.dart';
part 'pose_preset.g.dart';

@freezed
abstract class PosePreset with _$PosePreset {
  const factory PosePreset({
    required String id,
    required String name,
    required String gender,
    required String garmentTypeId,
    required List<String> poseIds,
    @Default(false) bool isLastUsed,
    required String updatedAt,
  }) = _PosePreset;

  factory PosePreset.fromJson(Map<String, dynamic> json) =>
      _$PosePresetFromJson(json);
}

@freezed
abstract class PosePresetsResponse with _$PosePresetsResponse {
  const factory PosePresetsResponse({
    PosePreset? lastUsed,
    required List<PosePreset> named,
  }) = _PosePresetsResponse;

  factory PosePresetsResponse.fromJson(Map<String, dynamic> json) =>
      _$PosePresetsResponseFromJson(json);
}

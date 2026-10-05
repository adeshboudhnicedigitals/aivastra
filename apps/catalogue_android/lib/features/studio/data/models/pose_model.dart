import 'package:freezed_annotation/freezed_annotation.dart';

part 'pose_model.freezed.dart';
part 'pose_model.g.dart';

@freezed
abstract class PoseModel with _$PoseModel {
  const factory PoseModel({
    required String id,
    required String label,
    required String thumbnailUrl,
    @Default(false) bool hasLower,
    @Default(false) bool hasShoes,
    @Default(false) bool hasAspectRatio,
  }) = _PoseModel;

  factory PoseModel.fromJson(Map<String, dynamic> json) =>
      _$PoseModelFromJson(json);
}

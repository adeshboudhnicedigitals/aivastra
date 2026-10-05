import 'package:freezed_annotation/freezed_annotation.dart';

part 'face_model.freezed.dart';
part 'face_model.g.dart';

@freezed
abstract class FaceModel with _$FaceModel {
  const factory FaceModel({
    required String id,
    required String gender,
    required String label,
    String? continent,
    required String thumbnailUrl,
    List<String>? tags,
  }) = _FaceModel;

  factory FaceModel.fromJson(Map<String, dynamic> json) =>
      _$FaceModelFromJson(json);
}

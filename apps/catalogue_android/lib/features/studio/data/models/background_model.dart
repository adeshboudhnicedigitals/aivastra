import 'package:freezed_annotation/freezed_annotation.dart';

part 'background_model.freezed.dart';
part 'background_model.g.dart';

@freezed
abstract class BackgroundModel with _$BackgroundModel {
  const factory BackgroundModel({
    required String id,
    required String label,
    required String thumbnailUrl,
    required String previewUrl,
    @Default(false) bool isWhiteBg,
    int? categoryId,
    List<String>? tags,
    String? specialTag,
  }) = _BackgroundModel;

  factory BackgroundModel.fromJson(Map<String, dynamic> json) =>
      _$BackgroundModelFromJson(json);
}

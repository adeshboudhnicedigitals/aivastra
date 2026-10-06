import 'package:freezed_annotation/freezed_annotation.dart';

part 'catalogue_template.freezed.dart';
part 'catalogue_template.g.dart';

@freezed
abstract class TemplateLook with _$TemplateLook {
  const factory TemplateLook({
    required String id,
    required String poseId,
    required String poseLabel,
    required String poseThumbnailUrl,
    required String backgroundId,
    required String backgroundLabel,
    required String backgroundThumbnailUrl,
    @Default(false) bool hasLower,
    @Default(false) bool hasShoes,
  }) = _TemplateLook;

  factory TemplateLook.fromJson(Map<String, dynamic> json) =>
      _$TemplateLookFromJson(json);
}

@freezed
abstract class CatalogueTemplate with _$CatalogueTemplate {
  const factory CatalogueTemplate({
    required String id,
    required String mappingId,
    required String label,
    String? thumbnailUrl,
    required List<TemplateLook> looks,
  }) = _CatalogueTemplate;

  factory CatalogueTemplate.fromJson(Map<String, dynamic> json) =>
      _$CatalogueTemplateFromJson(json);
}

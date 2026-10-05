import 'package:freezed_annotation/freezed_annotation.dart';

part 'background_category.freezed.dart';
part 'background_category.g.dart';

@freezed
abstract class BackgroundCategory with _$BackgroundCategory {
  const factory BackgroundCategory({
    required int id,
    required String slug,
    required String label,
    String? thumbnailUrl,
  }) = _BackgroundCategory;

  factory BackgroundCategory.fromJson(Map<String, dynamic> json) =>
      _$BackgroundCategoryFromJson(json);
}

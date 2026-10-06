import 'package:freezed_annotation/freezed_annotation.dart';

part 'custom_background.freezed.dart';
part 'custom_background.g.dart';

/// A user's own uploaded/imported background (`/v1/backgrounds/mine`) — its
/// `id` is used exactly like an admin-curated background's `id` for
/// `backgroundId` in job creation.
@freezed
abstract class CustomBackground with _$CustomBackground {
  const factory CustomBackground({
    required String id,
    required String label,
    required String thumbnailUrl,
  }) = _CustomBackground;

  factory CustomBackground.fromJson(Map<String, dynamic> json) =>
      _$CustomBackgroundFromJson(json);
}

@freezed
abstract class BackgroundUploadPresign with _$BackgroundUploadPresign {
  const factory BackgroundUploadPresign({
    required String uploadUrl,
    required String r2Key,
    required String id,
    required int expiresIn,
  }) = _BackgroundUploadPresign;

  factory BackgroundUploadPresign.fromJson(Map<String, dynamic> json) =>
      _$BackgroundUploadPresignFromJson(json);
}

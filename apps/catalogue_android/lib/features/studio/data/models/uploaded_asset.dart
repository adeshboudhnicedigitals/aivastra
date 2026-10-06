import 'package:freezed_annotation/freezed_annotation.dart';

part 'uploaded_asset.freezed.dart';
part 'uploaded_asset.g.dart';

/// One of the account's uploaded garment photos, deduplicated by R2 key
/// (`GET /v1/assets`) — backs the Products grid.
@freezed
abstract class UploadedAsset with _$UploadedAsset {
  const factory UploadedAsset({
    required String r2Key,
    required String uploadedAt,
    required int jobsCount,
    String? thumbnailUrl,
  }) = _UploadedAsset;

  factory UploadedAsset.fromJson(Map<String, dynamic> json) =>
      _$UploadedAssetFromJson(json);
}

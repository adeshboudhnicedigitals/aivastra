import 'package:freezed_annotation/freezed_annotation.dart';

part 'upload_presign.freezed.dart';
part 'upload_presign.g.dart';

@freezed
abstract class UploadPresign with _$UploadPresign {
  const factory UploadPresign({
    required String uploadUrl,
    required String r2Key,
    required int expiresIn,
  }) = _UploadPresign;

  factory UploadPresign.fromJson(Map<String, dynamic> json) =>
      _$UploadPresignFromJson(json);
}

import 'package:freezed_annotation/freezed_annotation.dart';

part 'tryon_submit_result.freezed.dart';
part 'tryon_submit_result.g.dart';

@freezed
abstract class TryonSubmitResult with _$TryonSubmitResult {
  const factory TryonSubmitResult({
    required String catalogueId,
    required List<String> jobIds,
    List<String>? poseIds,
    String? gender,
    String? garmentTypeId,
  }) = _TryonSubmitResult;

  factory TryonSubmitResult.fromJson(Map<String, dynamic> json) =>
      _$TryonSubmitResultFromJson(json);
}

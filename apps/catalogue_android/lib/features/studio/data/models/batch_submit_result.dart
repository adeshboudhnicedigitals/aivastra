import 'package:freezed_annotation/freezed_annotation.dart';

part 'batch_submit_result.freezed.dart';
part 'batch_submit_result.g.dart';

@freezed
abstract class BatchCatalogueGroup with _$BatchCatalogueGroup {
  const factory BatchCatalogueGroup({
    required int rowIndex,
    required String catalogueId,
    required List<String> jobIds,
  }) = _BatchCatalogueGroup;

  factory BatchCatalogueGroup.fromJson(Map<String, dynamic> json) =>
      _$BatchCatalogueGroupFromJson(json);
}

/// Response of `POST /v1/jobs/batch` — one row can still fail to enqueue
/// after credits are charged (a queue outage), so [failedJobIds] is
/// reported rather than assumed empty; [creditsCharged] already reflects
/// whatever the server refunded for those before this response was sent.
@freezed
abstract class BatchSubmitResult with _$BatchSubmitResult {
  const factory BatchSubmitResult({
    required String batchId,
    required int totalJobs,
    required int creditsCharged,
    required List<BatchCatalogueGroup> catalogues,
    @Default(<String>[]) List<String> failedJobIds,
  }) = _BatchSubmitResult;

  factory BatchSubmitResult.fromJson(Map<String, dynamic> json) =>
      _$BatchSubmitResultFromJson(json);
}

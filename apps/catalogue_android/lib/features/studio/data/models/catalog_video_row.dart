import 'package:freezed_annotation/freezed_annotation.dart';

part 'catalog_video_row.freezed.dart';
part 'catalog_video_row.g.dart';

const _terminalStatuses = {'COMPLETED', 'FAILED', 'CANCELLED'};

/// One of the account's catalog-video (Motion Studio) jobs (`GET
/// /v1/catalog-videos`) — unlike [JobRow], the result/thumbnail URLs come
/// back already presigned, so no extra round trip is needed to render it.
@freezed
abstract class CatalogVideoRow with _$CatalogVideoRow {
  const CatalogVideoRow._();

  const factory CatalogVideoRow({
    required String id,
    required String status,
    required String createdAt,
    String? sampleVideoId,
    String? videoUrl,
    String? thumbnailUrl,
    // Whole seconds (1-15), snapshotted onto the job at creation time — see
    // apps/api/src/modules/jobs/create.ts. Null for any row created before
    // the API started returning it.
    int? duration,
  }) = _CatalogVideoRow;

  factory CatalogVideoRow.fromJson(Map<String, dynamic> json) =>
      _$CatalogVideoRowFromJson(json);

  bool get isTerminal => _terminalStatuses.contains(status.toUpperCase());
  bool get isCompleted => status.toUpperCase() == 'COMPLETED';
  bool get isFailed =>
      status.toUpperCase() == 'FAILED' || status.toUpperCase() == 'CANCELLED';
}

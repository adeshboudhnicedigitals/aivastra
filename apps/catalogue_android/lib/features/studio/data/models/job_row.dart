import 'package:freezed_annotation/freezed_annotation.dart';

part 'job_row.freezed.dart';
part 'job_row.g.dart';

const _terminalStatuses = {'COMPLETED', 'FAILED', 'CANCELLED'};

@freezed
abstract class JobRow with _$JobRow {
  const JobRow._();

  const factory JobRow({
    required String id,
    required String status,
    required String createdAt,
    String? completedAt,
    String? errorMessage,
    String? assetKind,
    int? watermarkVersion,
    bool? alreadyDownloaded,
    int? creditsCharged,
  }) = _JobRow;

  factory JobRow.fromJson(Map<String, dynamic> json) => _$JobRowFromJson(json);

  bool get isTerminal => _terminalStatuses.contains(status.toUpperCase());
  bool get isCompleted => status.toUpperCase() == 'COMPLETED';
  bool get isFailed =>
      status.toUpperCase() == 'FAILED' || status.toUpperCase() == 'CANCELLED';
}

@freezed
abstract class PresignedUrl with _$PresignedUrl {
  const factory PresignedUrl({required String url, required int expiresIn}) =
      _PresignedUrl;

  factory PresignedUrl.fromJson(Map<String, dynamic> json) =>
      _$PresignedUrlFromJson(json);
}

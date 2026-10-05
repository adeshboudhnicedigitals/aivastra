import 'package:freezed_annotation/freezed_annotation.dart';

part 'credits_summary.freezed.dart';
part 'credits_summary.g.dart';

@freezed
abstract class CreditLedgerRow with _$CreditLedgerRow {
  // Mirrors `GET /v1/credits` `recent[]` exactly. This used to declare
  // title/amount/isCredit/status — fields the server never sends — so parsing
  // the whole response threw and the credits badge silently showed 0.
  const factory CreditLedgerRow({
    required String id,
    @Default(0) int delta,
    @Default('') String reason,
    @Default('') String createdAt,
    // Which flow created the underlying job (packages/types/src/job-taxonomy.ts
    // JOB_SOURCE) - null for non-job ledger rows (PAYMENT, FREE_TRIAL, ...).
    // Lets JOB_DISPATCH rows read as "Image generation" vs "Video generation"
    // instead of one generic label for every dispatch.
    String? jobSource,
    // Garment type label of the job (e.g. "Kurta"), when the server has one.
    String? garmentType,
  }) = _CreditLedgerRow;

  factory CreditLedgerRow.fromJson(Map<String, dynamic> json) =>
      _$CreditLedgerRowFromJson(json);
}

@freezed
abstract class CreditsSummary with _$CreditsSummary {
  const factory CreditsSummary({
    @Default(0) int balance,
    @Default([]) List<CreditLedgerRow> recent,
    Map<String, dynamic>? unlimitedPlan,
  }) = _CreditsSummary;

  factory CreditsSummary.fromJson(Map<String, dynamic> json) =>
      _$CreditsSummaryFromJson(json);
}

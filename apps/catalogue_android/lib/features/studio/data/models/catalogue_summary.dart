import 'package:freezed_annotation/freezed_annotation.dart';

import 'job_row.dart';

part 'catalogue_summary.freezed.dart';
part 'catalogue_summary.g.dart';

@freezed
abstract class CatalogueSummary with _$CatalogueSummary {
  const factory CatalogueSummary({
    required String catalogueId,
    String? genderSlug,
    String? platform,
    String? garmentType,
    @Default([]) List<JobRow> jobs,
    required String createdAt,
    String? coverUrl,
    String? coverThumbUrl,
  }) = _CatalogueSummary;

  factory CatalogueSummary.fromJson(Map<String, dynamic> json) =>
      _$CatalogueSummaryFromJson(json);
}

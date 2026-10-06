import 'package:freezed_annotation/freezed_annotation.dart';

import 'job_row.dart';

part 'catalogue_detail.freezed.dart';
part 'catalogue_detail.g.dart';

@freezed
abstract class CatalogueDetail with _$CatalogueDetail {
  const CatalogueDetail._();

  const factory CatalogueDetail({
    required String catalogueId,
    @Default([]) List<JobRow> jobs,
    String? aspectRatio,
    String? platform,
    String? garmentUrl,
    bool? currentPlanWatermark,
    String? gender,
    String? garmentName,
  }) = _CatalogueDetail;

  factory CatalogueDetail.fromJson(Map<String, dynamic> json) =>
      _$CatalogueDetailFromJson(json);

  bool get allJobsTerminal => jobs.every((j) => j.isTerminal);
}

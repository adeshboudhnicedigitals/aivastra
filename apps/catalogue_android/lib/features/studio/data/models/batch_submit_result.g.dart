// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'batch_submit_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_BatchCatalogueGroup _$BatchCatalogueGroupFromJson(Map<String, dynamic> json) =>
    _BatchCatalogueGroup(
      rowIndex: (json['rowIndex'] as num).toInt(),
      catalogueId: json['catalogueId'] as String,
      jobIds: (json['jobIds'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$BatchCatalogueGroupToJson(
  _BatchCatalogueGroup instance,
) => <String, dynamic>{
  'rowIndex': instance.rowIndex,
  'catalogueId': instance.catalogueId,
  'jobIds': instance.jobIds,
};

_BatchSubmitResult _$BatchSubmitResultFromJson(Map<String, dynamic> json) =>
    _BatchSubmitResult(
      batchId: json['batchId'] as String,
      totalJobs: (json['totalJobs'] as num).toInt(),
      creditsCharged: (json['creditsCharged'] as num).toInt(),
      catalogues: (json['catalogues'] as List<dynamic>)
          .map((e) => BatchCatalogueGroup.fromJson(e as Map<String, dynamic>))
          .toList(),
      failedJobIds:
          (json['failedJobIds'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
    );

Map<String, dynamic> _$BatchSubmitResultToJson(_BatchSubmitResult instance) =>
    <String, dynamic>{
      'batchId': instance.batchId,
      'totalJobs': instance.totalJobs,
      'creditsCharged': instance.creditsCharged,
      'catalogues': instance.catalogues,
      'failedJobIds': instance.failedJobIds,
    };

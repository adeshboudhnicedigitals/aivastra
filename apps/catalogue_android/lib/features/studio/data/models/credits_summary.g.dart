// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'credits_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CreditLedgerRow _$CreditLedgerRowFromJson(Map<String, dynamic> json) =>
    _CreditLedgerRow(
      id: json['id'] as String,
      delta: (json['delta'] as num?)?.toInt() ?? 0,
      reason: json['reason'] as String? ?? '',
      createdAt: json['createdAt'] as String? ?? '',
      jobSource: json['jobSource'] as String?,
      garmentType: json['garmentType'] as String?,
    );

Map<String, dynamic> _$CreditLedgerRowToJson(_CreditLedgerRow instance) =>
    <String, dynamic>{
      'id': instance.id,
      'delta': instance.delta,
      'reason': instance.reason,
      'createdAt': instance.createdAt,
      'jobSource': instance.jobSource,
      'garmentType': instance.garmentType,
    };

_CreditsSummary _$CreditsSummaryFromJson(Map<String, dynamic> json) =>
    _CreditsSummary(
      balance: (json['balance'] as num?)?.toInt() ?? 0,
      recent:
          (json['recent'] as List<dynamic>?)
              ?.map((e) => CreditLedgerRow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      unlimitedPlan: json['unlimitedPlan'] as Map<String, dynamic>?,
    );

Map<String, dynamic> _$CreditsSummaryToJson(_CreditsSummary instance) =>
    <String, dynamic>{
      'balance': instance.balance,
      'recent': instance.recent,
      'unlimitedPlan': instance.unlimitedPlan,
    };

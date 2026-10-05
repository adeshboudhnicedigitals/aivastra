import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../config/api_paths.dart';
import '../../../core/network/dio_exception_mapper.dart';
import '../../../core/providers/core_providers.dart';
import '../data/credit_plan.dart';
import '../data/payment_record.dart';

/// The catalogue credit packs on sale - `GET /v1/payments/plans` (public),
/// minus the free plan and the try-on packs, in the admin's display order.
final creditPlansProvider = FutureProvider<List<CreditPlan>>((ref) async {
  final dio = ref.watch(dioProvider);
  try {
    final response = await dio.get(ApiPaths.paymentPlans);
    final plans =
        [
            for (final row in response.data as List<dynamic>)
              CreditPlan.fromJson(row as Map<String, dynamic>),
          ].where((p) => p.slug != 'free' && p.planType == 'catalogue').toList()
          ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return plans;
  } on DioException catch (e) {
    throw DioExceptionMapper.map(e);
  }
});

/// The account's purchases, newest first - `GET /v1/payments/history`.
/// Re-read each time the page is opened so a payment just made on the web
/// shows up (and its invoice link, which is a short-lived presigned URL, is
/// never stale).
final paymentHistoryProvider = FutureProvider.autoDispose<List<PaymentRecord>>((
  ref,
) async {
  final dio = ref.watch(dioProvider);
  try {
    final response = await dio.get(ApiPaths.paymentHistory);
    final rows = (response.data as Map<String, dynamic>)['payments'] as List;
    return [
      for (final row in rows)
        PaymentRecord.fromJson(row as Map<String, dynamic>),
    ];
  } on DioException catch (e) {
    throw DioExceptionMapper.map(e);
  }
});

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/api_paths.dart';
import '../../core/network/dio_exception_mapper.dart';
import '../../core/providers/core_providers.dart';

/// Sends a Contact Us message - `POST /v1/contact`, the same call as the web
/// app's contact page. The server opens (or continues) the account's support
/// ticket with it, so the team replies through the usual support channel.
final contactSubmitterProvider =
    Provider<
      Future<void> Function({
        required String name,
        required String email,
        required String phone,
        String? message,
      })
    >((ref) {
      final dio = ref.watch(dioProvider);
      return ({
        required String name,
        required String email,
        required String phone,
        String? message,
      }) async {
        try {
          await dio.post(
            ApiPaths.contact,
            data: {
              'name': name,
              'email': email,
              'phone': phone,
              'source': 'contact-us',
              'message': ?message,
            },
          );
        } on DioException catch (e) {
          throw DioExceptionMapper.map(e);
        }
      };
    });

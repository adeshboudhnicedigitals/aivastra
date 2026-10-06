import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../config/app_config.dart';

Dio buildDio() {
  final dio = Dio(
    BaseOptions(
      baseUrl: AppConfig.baseUrl,
      connectTimeout: AppConfig.connectTimeout,
      receiveTimeout: AppConfig.receiveTimeout,
      contentType: 'application/json',
    ),
  );

  // Fastify rejects `content-type: application/json` with no body as a 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY). The base options above set that header on
  // every request, so any body-less call - DELETE, or a POST like /download -
  // failed until each was patched by hand. Drop the header when there is
  // nothing to declare a type for.
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.data == null) {
          options.headers.remove(Headers.contentTypeHeader);
        }
        handler.next(options);
      },
    ),
  );

  // Request line and status only. Bodies used to be logged too, and printing
  // a whole catalogue list to the console on the UI thread froze debug
  // builds for the length of the print on every list fetch.
  if (kDebugMode) {
    dio.interceptors.add(
      LogInterceptor(
        requestHeader: false,
        responseHeader: false,
        requestBody: false,
        responseBody: false,
      ),
    );
  }

  return dio;
}

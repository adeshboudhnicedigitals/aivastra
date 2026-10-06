import 'package:dio/dio.dart';

import '../../../../config/api_paths.dart';
import '../../../../core/network/app_exception.dart';
import '../../../../core/network/dio_exception_mapper.dart';
import '../models/batch_submit_result.dart';
import '../models/catalog_video_row.dart';
import '../models/catalogue_detail.dart';
import '../models/catalogue_summary.dart';
import '../models/job_row.dart';
import '../models/tryon_submit_result.dart';
import '../models/uploaded_asset.dart';

class JobsApi {
  JobsApi(this._dio);

  final Dio _dio;

  Future<TryonSubmitResult> submitTryon({
    String? catalogueId,
    required Map<String, dynamic> inputs,
    Map<String, dynamic>? params,
    String? userHint,
    required String aspectRatio,
    required String resolution,
    String? platform,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.jobsTryon,
        data: {
          'catalogueId': ?catalogueId,
          'inputs': inputs,
          'params': ?params,
          'userHint': ?userHint,
          'aspectRatio': aspectRatio,
          'resolution': resolution,
          'platform': ?platform,
        },
      );
      return TryonSubmitResult.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<TryonSubmitResult> submitSareeMannequin({
    required String garmentTypeId,
    required String garmentKey,
    String? secondGarmentKey,
    required String faceId,
    required Map<String, dynamic> step2,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.jobsSareeMannequin,
        data: {
          'garmentTypeId': garmentTypeId,
          'garmentKey': garmentKey,
          'secondGarmentKey': ?secondGarmentKey,
          'faceId': faceId,
          'step2': step2,
        },
      );
      return TryonSubmitResult.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// `POST /v1/jobs/batch` — one row per look (its own garment upload, face,
  /// background, poses, optional lower/shoe); `garmentTypeId`, `aspectRatio`,
  /// `resolution` and `platform` are shared across the whole grid. Batch
  /// deliberately excludes the mannequin two-pass and catalogue-template
  /// flows — see `BatchRowInputs` in `packages/types/src/batch.ts`.
  Future<BatchSubmitResult> submitBatch({
    required String garmentTypeId,
    required String aspectRatio,
    required String resolution,
    String? platform,
    Map<String, dynamic>? params,
    String? userHint,
    required List<Map<String, dynamic>> rows,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.jobsBatch,
        data: {
          'garmentTypeId': garmentTypeId,
          'aspectRatio': aspectRatio,
          'resolution': resolution,
          'platform': ?platform,
          'params': ?params,
          'userHint': ?userHint,
          'rows': rows,
        },
      );
      return BatchSubmitResult.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final mapped = DioExceptionMapper.map(e);
      // A rejection tied to one row carries `error.rowIndex` (withRowIndex in
      // apps/api/src/lib/errors.ts); the mapper only keeps the message, which
      // alone doesn't say which row to fix.
      final body = e.response?.data;
      final error = body is Map<String, dynamic> ? body['error'] : null;
      final rowIndex = error is Map<String, dynamic>
          ? error['rowIndex']
          : null;
      if (rowIndex is int && mapped is BadRequestException) {
        throw AppException.badRequest(
          'Row ${rowIndex + 1}: ${mapped.message}',
        );
      }
      throw mapped;
    }
  }

  Future<List<CatalogueSummary>> listCatalogues({String? batchId}) async {
    try {
      final response = await _dio.get(
        ApiPaths.catalogues,
        queryParameters: {'batchId': ?batchId},
      );
      final items = response.data as List<dynamic>;
      return items
          .map((e) => CatalogueSummary.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<CatalogueDetail> catalogueDetail(String id) async {
    try {
      final response = await _dio.get(ApiPaths.catalogue(id));
      return CatalogueDetail.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// The account's unique uploaded garment photos, deduplicated by R2 key.
  Future<List<UploadedAsset>> assets() async {
    try {
      final response = await _dio.get(ApiPaths.assets);
      final items = response.data as List<dynamic>;
      return items
          .map((e) => UploadedAsset.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// The account's catalog-video (Motion Studio) jobs. Throws
  /// [AppException.forbidden] when catalog video isn't enabled for this
  /// account — callers should treat that as an empty list, not an error.
  Future<List<CatalogVideoRow>> catalogVideos() async {
    try {
      final response = await _dio.get(ApiPaths.catalogVideos);
      final items = response.data as List<dynamic>;
      return items
          .map((e) => CatalogVideoRow.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<JobRow> getJob(String id) async {
    try {
      final response = await _dio.get(ApiPaths.job(id));
      return JobRow.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<PresignedUrl> jobResult(String id) async {
    try {
      final response = await _dio.get(ApiPaths.jobResult(id));
      return PresignedUrl.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<PresignedUrl> jobThumbnail(String id) async {
    try {
      final response = await _dio.get(ApiPaths.jobThumbnail(id));
      return PresignedUrl.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<PresignedUrl> download(String id) async {
    try {
      final response = await _dio.post(
        ApiPaths.jobDownload(id),
        // An empty JSON object, not a null body: the client sends
        // `content-type: application/json`, and Fastify rejects that with
        // no body as a 400 (FST_ERR_CTP_EMPTY_JSON_BODY). The web app sends
        // `{}` for the same reason.
        data: <String, dynamic>{},
      );
      return PresignedUrl.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> cancel(String id) async {
    try {
      await _dio.post(ApiPaths.jobCancel(id), data: <String, dynamic>{});
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<void> delete(String id) async {
    try {
      await _dio.delete(ApiPaths.job(id));
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  Future<List<String>> regenerateReasons(String id) async {
    try {
      final response = await _dio.get(ApiPaths.jobRegenerateReasons(id));
      final reasons =
          (response.data as Map<String, dynamic>)['reasons'] as List<dynamic>;
      return reasons.cast<String>();
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }

  /// Returns the NEW job's id — the server replies `{ jobId }` only (not the
  /// `{ catalogueId, jobIds }` shape the tryon-create routes return).
  /// [idempotencyKey] makes a retried tap reuse the first result instead of
  /// queueing a second job.
  Future<String> regenerate(
    String id,
    String reason, {
    String? idempotencyKey,
  }) async {
    try {
      final response = await _dio.post(
        ApiPaths.jobRegenerate(id),
        data: {'reason': reason},
        options: idempotencyKey == null
            ? null
            : Options(headers: {'Idempotency-Key': idempotencyKey}),
      );
      return (response.data as Map<String, dynamic>)['jobId'] as String;
    } on DioException catch (e) {
      throw DioExceptionMapper.map(e);
    }
  }
}

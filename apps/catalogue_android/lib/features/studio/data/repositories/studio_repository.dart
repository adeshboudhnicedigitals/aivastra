// Constructor takes public named params but assigns to private fields, so
// the facade's callers can't reach into individual datasources directly.
// ignore_for_file: prefer_initializing_formals
import 'dart:io';

import '../datasources/catalog_api.dart';
import '../datasources/config_api.dart';
import '../datasources/credits_api.dart';
import '../datasources/custom_backgrounds_api.dart';
import '../datasources/jobs_api.dart';
import '../datasources/motion_api.dart';
import '../datasources/pose_presets_api.dart';
import '../datasources/studio_reference_api.dart';
import '../datasources/upload_api.dart';
import '../models/background_category.dart';
import '../models/background_model.dart';
import '../models/batch_submit_result.dart';
import '../models/catalog_node.dart';
import '../models/catalog_options.dart';
import '../models/catalog_video_row.dart';
import '../models/catalogue_detail.dart';
import '../models/catalogue_summary.dart';
import '../models/catalogue_template.dart';
import '../models/credits_summary.dart';
import '../models/custom_background.dart';
import '../models/face_model.dart';
import '../models/garment_type.dart';
import '../models/job_row.dart';
import '../models/pose_model.dart';
import '../models/pose_preset.dart';
import '../models/resolutions_config.dart';
import '../models/sample_video.dart';
import '../models/tryon_submit_result.dart';
import '../models/uploaded_asset.dart';

/// Single point of access for every Studio-domain endpoint. No abstract
/// interface layer on top of this (see plan: "lightweight" — Riverpod
/// overrides are enough to swap this in tests without a second
/// implementation).
class StudioRepository {
  StudioRepository({
    required StudioReferenceApi referenceApi,
    required CatalogApi catalogApi,
    required PosePresetsApi posePresetsApi,
    required UploadApi uploadApi,
    required JobsApi jobsApi,
    required MotionApi motionApi,
    required ConfigApi configApi,
    required CreditsApi creditsApi,
    required CustomBackgroundsApi customBackgroundsApi,
  }) : _referenceApi = referenceApi,
       _catalogApi = catalogApi,
       _posePresetsApi = posePresetsApi,
       _uploadApi = uploadApi,
       _jobsApi = jobsApi,
       _motionApi = motionApi,
       _configApi = configApi,
       _creditsApi = creditsApi,
       _customBackgroundsApi = customBackgroundsApi;

  final StudioReferenceApi _referenceApi;
  final CatalogApi _catalogApi;
  final PosePresetsApi _posePresetsApi;
  final UploadApi _uploadApi;
  final JobsApi _jobsApi;
  final MotionApi _motionApi;
  final ConfigApi _configApi;
  final CreditsApi _creditsApi;
  final CustomBackgroundsApi _customBackgroundsApi;

  // Reference data
  Future<List<GarmentType>> garmentTypes(String gender) =>
      _referenceApi.garmentTypes(gender);

  Future<List<FaceModel>> faces(String gender) => _referenceApi.faces(gender);

  Future<List<BackgroundModel>> backgrounds({String? gender}) =>
      _referenceApi.backgrounds(gender: gender);

  Future<List<BackgroundCategory>> backgroundCategories({String? gender}) =>
      _referenceApi.backgroundCategories(gender: gender);

  Future<List<PoseModel>> poses({
    required String gender,
    String? garmentTypeId,
  }) => _referenceApi.poses(gender: gender, garmentTypeId: garmentTypeId);

  Future<List<CatalogueTemplate>> catalogueTemplates({
    required String gender,
    required String garmentTypeId,
  }) => _referenceApi.catalogueTemplates(
    gender: gender,
    garmentTypeId: garmentTypeId,
  );

  Future<CatalogTree> catalogTree({
    required String type,
    String? gender,
    String? garmentTypeId,
    List<String>? poseIds,
  }) => _catalogApi.tree(
    type: type,
    gender: gender,
    garmentTypeId: garmentTypeId,
    poseIds: poseIds,
  );

  /// Fetches all selectable catalog options in a single call via
  /// `GET /v1/dev/catalog/options`.
  Future<CatalogOptions> catalogOptions({
    required String gender,
    String? garmentType,
  }) => _catalogApi.catalogOptions(gender: gender, garmentType: garmentType);

  // Pose presets
  Future<PosePresetsResponse> posePresets({
    required String gender,
    required String garmentTypeId,
  }) => _posePresetsApi.list(gender: gender, garmentTypeId: garmentTypeId);

  Future<PosePreset> savePosePreset({
    required String name,
    required String gender,
    required String garmentTypeId,
    required List<String> poseIds,
  }) => _posePresetsApi.create(
    name: name,
    gender: gender,
    garmentTypeId: garmentTypeId,
    poseIds: poseIds,
  );

  Future<void> deletePosePreset(String id) => _posePresetsApi.delete(id);

  // Upload
  Future<String> presignAndUpload(File file) =>
      _uploadApi.presignAndUpload(file);

  // Custom (user-uploaded) backgrounds
  Future<List<CustomBackground>> myBackgrounds() =>
      _customBackgroundsApi.list();

  Future<CustomBackground> uploadCustomBackground(File file, {String? label}) =>
      _customBackgroundsApi.uploadFile(file, label: label);

  Future<CustomBackground> addCustomBackgroundFromUrl(
    String url, {
    String? label,
  }) => _customBackgroundsApi.fromUrl(url: url, label: label);

  Future<void> deleteCustomBackground(String id) =>
      _customBackgroundsApi.delete(id);

  // Catalogue Studio jobs
  Future<TryonSubmitResult> submitTryon({
    String? catalogueId,
    required Map<String, dynamic> inputs,
    Map<String, dynamic>? params,
    String? userHint,
    required String aspectRatio,
    required String resolution,
    String? platform,
  }) => _jobsApi.submitTryon(
    catalogueId: catalogueId,
    inputs: inputs,
    params: params,
    userHint: userHint,
    aspectRatio: aspectRatio,
    resolution: resolution,
    platform: platform,
  );

  Future<TryonSubmitResult> submitSareeMannequin({
    required String garmentTypeId,
    required String garmentKey,
    String? secondGarmentKey,
    required String faceId,
    required Map<String, dynamic> step2,
  }) => _jobsApi.submitSareeMannequin(
    garmentTypeId: garmentTypeId,
    garmentKey: garmentKey,
    secondGarmentKey: secondGarmentKey,
    faceId: faceId,
    step2: step2,
  );

  Future<BatchSubmitResult> submitBatch({
    required String garmentTypeId,
    required String aspectRatio,
    required String resolution,
    String? platform,
    Map<String, dynamic>? params,
    String? userHint,
    required List<Map<String, dynamic>> rows,
  }) => _jobsApi.submitBatch(
    garmentTypeId: garmentTypeId,
    aspectRatio: aspectRatio,
    resolution: resolution,
    platform: platform,
    params: params,
    userHint: userHint,
    rows: rows,
  );

  Future<List<CatalogueSummary>> listCatalogues({String? batchId}) =>
      _jobsApi.listCatalogues(batchId: batchId);

  Future<CatalogueDetail> catalogueDetail(String id) =>
      _jobsApi.catalogueDetail(id);

  Future<List<UploadedAsset>> assets() => _jobsApi.assets();

  Future<List<CatalogVideoRow>> catalogVideos() => _jobsApi.catalogVideos();

  Future<JobRow> getJob(String id) => _jobsApi.getJob(id);

  Future<PresignedUrl> jobResult(String id) => _jobsApi.jobResult(id);

  Future<PresignedUrl> jobThumbnail(String id) => _jobsApi.jobThumbnail(id);

  Future<PresignedUrl> downloadJob(String id) => _jobsApi.download(id);

  Future<void> cancelJob(String id) => _jobsApi.cancel(id);

  Future<void> deleteJob(String id) => _jobsApi.delete(id);

  Future<List<String>> regenerateReasons(String id) =>
      _jobsApi.regenerateReasons(id);

  Future<String> regenerate(
    String id,
    String reason, {
    String? idempotencyKey,
  }) => _jobsApi.regenerate(id, reason, idempotencyKey: idempotencyKey);

  // Motion Studio
  Future<SampleVideosResponse> sampleVideos() => _motionApi.sampleVideos();

  Future<String> submitCatalogVideo({
    String? sourceJobId,
    String? sourceImageKey,
    String? sampleVideoId,
    int? duration,
    required String quality,
  }) => _motionApi.submitCatalogVideo(
    sourceJobId: sourceJobId,
    sourceImageKey: sourceImageKey,
    sampleVideoId: sampleVideoId,
    duration: duration,
    quality: quality,
  );

  // Config / credits
  Future<ResolutionsConfig> resolutions() => _configApi.resolutions();

  Future<CreditsSummary> credits() => _creditsApi.credits();
}

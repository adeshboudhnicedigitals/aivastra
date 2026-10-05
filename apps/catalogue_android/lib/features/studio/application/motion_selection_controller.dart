import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/sample_video.dart';
import 'motion_selection_state.dart';
import 'studio_providers.dart';
import 'studio_reference_providers.dart';

/// Note: the given `catalog-video` API has no field for a free-text prompt
/// or camera-movement/AI-motion-control toggles — only `sourceJobId` XOR
/// `sourceImageKey`, `sampleVideoId`, `duration` and `quality`. The prompt
/// text field and toggle controls stay as local, cosmetic-only UI state
/// (nothing invented on the wire) until the backend exposes them.
class MotionSelectionController extends Notifier<MotionSelectionState> {
  @override
  MotionSelectionState build() => const MotionSelectionState();

  void setMode(MotionMode mode) => state = state.copyWith(mode: mode);

  void selectSample(SampleVideo sample) => state = state.copyWith(
    selectedSample: sample,
    duration: sample.duration,
    quality: sample.quality,
  );

  void setPrompt(String prompt) => state = state.copyWith(prompt: prompt);
  void setDuration(int duration) => state = state.copyWith(duration: duration);
  void setQuality(String quality) => state = state.copyWith(quality: quality);

  void selectSourceJob(String jobId) =>
      state = state.copyWith(sourceJobId: jobId, sourceImageKey: null);

  void clearSource() =>
      state = state.copyWith(sourceJobId: null, sourceImageKey: null);

  Future<void> pickAndUploadSource(File file) async {
    state = state.copyWith(isUploadingSource: true);
    try {
      final key = await ref
          .read(studioRepositoryProvider)
          .presignAndUpload(file);
      state = state.copyWith(
        isUploadingSource: false,
        sourceImageKey: key,
        sourceJobId: null,
      );
    } on AppException catch (_) {
      state = state.copyWith(isUploadingSource: false);
    }
  }

  Future<String> submit() async {
    if (state.sourceImageKey == null && state.sourceJobId == null) {
      throw const AppException.badRequest(
        'Choose a source photo or catalogue first.',
      );
    }

    state = state.copyWith(isSubmitting: true, errorMessage: null);
    try {
      final sample = state.selectedSample;
      // duration/quality are always sent, even with a preset selected: both
      // default to the preset's own values on selection (selectSample) but
      // stay user-editable afterward, matching the API's "preset with
      // duration/quality override" variant (POST /v1/jobs/catalog-video with
      // sampleVideoId + duration + quality all set).
      final jobId = await ref
          .read(studioRepositoryProvider)
          .submitCatalogVideo(
            sourceJobId: state.sourceJobId,
            sourceImageKey: state.sourceImageKey,
            sampleVideoId: sample?.id,
            duration: state.duration,
            quality: state.quality,
          );
      state = state.copyWith(isSubmitting: false);
      ref.invalidate(creditsSummaryProvider);
      return jobId;
    } on AppException catch (e) {
      state = state.copyWith(isSubmitting: false, errorMessage: _messageOf(e));
      rethrow;
    }
  }

  String _messageOf(AppException e) => e.when(
    badRequest: (m) => m,
    unauthorized: (m) => m,
    emailNotVerified: (m) => m,
    forbidden: (m) => m,
    deviceLimitReached: (m, _, _, _) => m,
    invalidRefresh: (m) => m,
    rateLimited: (m) => m,
    network: (m) => m,
    server: (m) => m,
    unknown: (m) => m,
  );
}

final motionSelectionControllerProvider =
    NotifierProvider<MotionSelectionController, MotionSelectionState>(
      MotionSelectionController.new,
    );

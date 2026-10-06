import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/batch_submit_result.dart';
import '../data/models/garment_type.dart';
import '../data/models/gender.dart';
import '../data/models/pose_model.dart';
import 'batch_selection_state.dart';
import 'batch_validation.dart';
import 'studio_providers.dart';
import 'studio_reference_providers.dart';

/// How many garment uploads run at once. Firing every file's presign+PUT
/// together is what made a whole tray fail at once on a slow connection (the
/// web app's `BULK_UPLOAD_CONCURRENCY`).
const _uploadConcurrency = 3;

class BatchSelectionController extends Notifier<BatchSelectionState> {
  int _rowSeq = 0;

  @override
  BatchSelectionState build() => BatchSelectionState(rows: [_emptyRow()]);

  BatchRowState _emptyRow() => BatchRowState(id: 'row-${_rowSeq++}');

  void reset() => state = BatchSelectionState(rows: [_emptyRow()]);

  /// Batch has no audience-independent state: changing it throws the grid away
  /// (poses, faces and garment types all differ per gender).
  void selectGender(Gender gender) {
    state = BatchSelectionState(
      gender: gender,
      platform: state.platform,
      aspectRatio: state.aspectRatio,
      resolution: state.resolution,
      rows: [_emptyRow()],
    );
  }

  /// Batch has no mannequin two-pass support server-side (`BatchRowInputs`
  /// deliberately excludes it) — callers must only offer garment types where
  /// `requiresMannequinStep` is false. Poses differ per type, so the grid is
  /// cleared.
  void selectGarmentType(GarmentType garmentType) {
    state = state.copyWith(
      garmentType: garmentType,
      rows: [_emptyRow()],
      errorMessage: null,
      rejectedRowId: null,
    );
  }

  void selectPlatform(String platform) =>
      state = state.copyWith(platform: platform);
  void selectAspectRatio(String aspectRatio) =>
      state = state.copyWith(aspectRatio: aspectRatio);
  void selectResolution(String resolution) =>
      state = state.copyWith(resolution: resolution);

  void addRow() {
    if (state.rows.length >= kMaxBatchRows) return;
    state = state.copyWith(rows: [...state.rows, _emptyRow()]);
  }

  /// Copies [id]'s full selection into a new row right after it — the fast
  /// path for building several variations of the same look.
  void duplicateRow(String id) {
    if (state.rows.length >= kMaxBatchRows) return;
    final index = state.rows.indexWhere((r) => r.id == id);
    if (index == -1) return;
    final source = state.rows[index];
    final copy = source.copyWith(id: 'row-${_rowSeq++}', poseIds: {...source.poseIds});
    state = state.copyWith(
      rows: [
        ...state.rows.sublist(0, index + 1),
        copy,
        ...state.rows.sublist(index + 1),
      ],
    );
  }

  /// The grid never reaches zero rows — an empty one has no discoverable way
  /// to add another mid-task.
  void removeRow(String id) {
    final remaining = state.rows.where((r) => r.id != id).toList();
    state = state.copyWith(
      rows: remaining.isEmpty ? [_emptyRow()] : remaining,
      rejectedRowId: state.rejectedRowId == id ? null : state.rejectedRowId,
    );
  }

  void _updateRow(String id, BatchRowState Function(BatchRowState) update) {
    state = state.copyWith(
      rows: [
        for (final r in state.rows)
          if (r.id == id) update(r) else r,
      ],
    );
  }

  bool _isBlank(BatchRowState r) => !r.hasWork;

  // ── Garment uploads ───────────────────────────────────────────────────────

  /// Bulk upload: one file becomes one row. A lone untouched starter row is
  /// reused for the first file instead of being left behind empty. Uploads run
  /// with bounded concurrency; a file over the size cap is marked failed
  /// without being sent.
  Future<void> addGarments(List<File> files) async {
    if (files.isEmpty) return;

    final rows = [...state.rows];
    final reuseStarter = rows.length == 1 && _isBlank(rows.first);
    final room = kMaxBatchRows - (reuseStarter ? 0 : rows.length);
    final accepted = files.take(room).toList();
    if (accepted.isEmpty) return;

    final uploads = <({String rowId, File file})>[];
    final added = <BatchRowState>[];
    for (var i = 0; i < accepted.length; i++) {
      final file = accepted[i];
      final id = (reuseStarter && i == 0) ? rows.first.id : 'row-${_rowSeq++}';
      final tooBig = file.lengthSync() > kMaxGarmentBytes;
      added.add(
        BatchRowState(
          id: id,
          localImagePath: file.path,
          isUploadingGarment: !tooBig,
          garmentError: tooBig ? 'Over 10 MB' : null,
        ),
      );
      if (!tooBig) uploads.add((rowId: id, file: file));
    }

    state = state.copyWith(
      rows: [if (!reuseStarter) ...rows, ...added],
      errorMessage: null,
    );

    await _runLimited(uploads, (u) => _uploadUpper(u.rowId, u.file));
  }

  /// Replaces (or first sets) one row's garment — the row card's own upload.
  Future<void> pickAndUploadRowGarment(String id, File file) async {
    if (file.lengthSync() > kMaxGarmentBytes) {
      _updateRow(
        id,
        (r) => r.copyWith(
          localImagePath: file.path,
          upperGarmentKey: null,
          isUploadingGarment: false,
          garmentError: 'Over 10 MB',
        ),
      );
      return;
    }
    await _uploadUpper(id, file);
  }

  Future<void> retryGarment(String id) async {
    final row = state.rows.where((r) => r.id == id).firstOrNull;
    final path = row?.localImagePath;
    if (path == null) return;
    await pickAndUploadRowGarment(id, File(path));
  }

  Future<void> _uploadUpper(String id, File file) async {
    _updateRow(
      id,
      (r) => r.copyWith(
        isUploadingGarment: true,
        localImagePath: file.path,
        upperGarmentKey: null,
        garmentError: null,
      ),
    );
    try {
      final key = await ref
          .read(studioRepositoryProvider)
          .presignAndUpload(file);
      if (!ref.mounted) return;
      _updateRow(
        id,
        (r) => r.copyWith(isUploadingGarment: false, upperGarmentKey: key),
      );
    } on AppException catch (e) {
      if (!ref.mounted) return;
      _updateRow(
        id,
        (r) => r.copyWith(
          isUploadingGarment: false,
          garmentError: _messageOf(e),
        ),
      );
    }
  }

  void removeRowGarment(String id) => _updateRow(
    id,
    (r) => r.copyWith(
      upperGarmentKey: null,
      localImagePath: null,
      garmentError: null,
      isUploadingGarment: false,
    ),
  );

  Future<void> pickAndUploadRowLowerGarment(String id, File file) async {
    if (file.lengthSync() > kMaxGarmentBytes) {
      _updateRow(
        id,
        (r) => r.copyWith(
          localLowerImagePath: file.path,
          lowerGarmentKey: null,
          isUploadingLowerGarment: false,
          lowerGarmentError: 'Over 10 MB',
        ),
      );
      return;
    }
    _updateRow(
      id,
      (r) => r.copyWith(
        isUploadingLowerGarment: true,
        localLowerImagePath: file.path,
        lowerGarmentKey: null,
        lowerGarmentError: null,
      ),
    );
    try {
      final key = await ref
          .read(studioRepositoryProvider)
          .presignAndUpload(file);
      if (!ref.mounted) return;
      _updateRow(
        id,
        (r) => r.copyWith(isUploadingLowerGarment: false, lowerGarmentKey: key),
      );
    } on AppException catch (e) {
      if (!ref.mounted) return;
      _updateRow(
        id,
        (r) => r.copyWith(
          isUploadingLowerGarment: false,
          lowerGarmentError: _messageOf(e),
        ),
      );
    }
  }

  void removeRowLowerGarment(String id) => _updateRow(
    id,
    (r) => r.copyWith(
      lowerGarmentKey: null,
      localLowerImagePath: null,
      lowerGarmentError: null,
      isUploadingLowerGarment: false,
    ),
  );

  /// Runs [worker] over [items] with at most [_uploadConcurrency] in flight.
  Future<void> _runLimited<T>(
    List<T> items,
    Future<void> Function(T item) worker,
  ) async {
    var next = 0;
    Future<void> lane() async {
      while (next < items.length) {
        final item = items[next++];
        await worker(item);
      }
    }

    await Future.wait([
      for (var i = 0; i < _uploadConcurrency && i < items.length; i++) lane(),
    ]);
  }

  // ── Row selections ────────────────────────────────────────────────────────

  void selectRowFace(String id, String faceId) =>
      _updateRow(id, (r) => r.copyWith(faceId: faceId));

  void selectRowBackground(String id, String backgroundId) =>
      _updateRow(id, (r) => r.copyWith(backgroundId: backgroundId));

  /// Changing the poses can retire the lower/shoe requirement. Clear the
  /// now-irrelevant choice rather than keep showing a selection that has no
  /// effect (the API strips inputs the workflow doesn't support).
  BatchRowState _withPoses(
    BatchRowState r,
    Set<String> poseIds,
    List<PoseModel> poses,
  ) {
    final needs = requiredInputsForPoses(
      poses.where((p) => poseIds.contains(p.id)),
    );
    return r.copyWith(
      poseIds: {...poseIds},
      lowerCatalogItemId: needs.needsLower ? r.lowerCatalogItemId : null,
      shoeCatalogItemId: needs.needsShoes ? r.shoeCatalogItemId : null,
    );
  }

  void setRowPoses(String id, Set<String> poseIds, List<PoseModel> poses) =>
      _updateRow(id, (r) => _withPoses(r, poseIds, poses));

  void selectRowLowerCatalogItem(String id, String? itemId) =>
      _updateRow(id, (r) => r.copyWith(lowerCatalogItemId: itemId));

  void selectRowShoeCatalogItem(String id, String? itemId) =>
      _updateRow(id, (r) => r.copyWith(shoeCatalogItemId: itemId));

  // ── "Apply to all rows" ───────────────────────────────────────────────────

  void _updateAll(BatchRowState Function(BatchRowState) update) {
    state = state.copyWith(rows: [for (final r in state.rows) update(r)]);
  }

  void applyFaceToAll(String faceId) =>
      _updateAll((r) => r.copyWith(faceId: faceId));

  void applyBackgroundToAll(String backgroundId) =>
      _updateAll((r) => r.copyWith(backgroundId: backgroundId));

  void applyPosesToAll(Set<String> poseIds, List<PoseModel> poses) =>
      _updateAll((r) => _withPoses(r, poseIds, poses));

  void applyLowerToAll(String itemId) =>
      _updateAll((r) => r.copyWith(lowerCatalogItemId: itemId));

  void applyShoeToAll(String itemId) =>
      _updateAll((r) => r.copyWith(shoeCatalogItemId: itemId));

  // ── Submit ────────────────────────────────────────────────────────────────

  /// Sends every row (the web app blocks submitting until each one is
  /// complete, rather than dropping the unfinished ones). [poses] are this
  /// grid's poses for the chosen type — needed to know which rows require a
  /// lower garment or shoes.
  Future<BatchSubmitResult> submit({required List<PoseModel> poses}) async {
    final garmentType = state.garmentType;
    if (garmentType == null) {
      throw const AppException.badRequest('Choose a garment type first.');
    }
    final rows = state.rows;
    if (invalidBatchRows(rows, garmentType: garmentType, poses: poses)
        .isNotEmpty) {
      throw const AppException.badRequest(
        'Finish every row: garment photo, model, background and a pose.',
      );
    }

    state = state.copyWith(
      isSubmitting: true,
      errorMessage: null,
      rejectedRowId: null,
    );
    try {
      // Same web-app workaround as the single-look submit
      // (catalogue_selection_controller.dart) — sending platform:'Amazon'
      // literally makes the server try to swap in an admin-configured white
      // background (resolveTryonPlan, shared by this batch path too) and
      // throw "Amazon platform requires a white background to be
      // configured" when none is set up.
      final effectivePlatform = state.platform == 'Amazon'
          ? null
          : state.platform;
      final result = await ref
          .read(studioRepositoryProvider)
          .submitBatch(
            garmentTypeId: garmentType.id,
            aspectRatio: state.aspectRatio,
            resolution: state.resolution,
            platform: effectivePlatform,
            rows: [
              for (final r in rows)
                _payloadFor(r, garmentType: garmentType, poses: poses),
            ],
          );
      if (!ref.mounted) return result;
      state = state.copyWith(isSubmitting: false);
      ref.invalidate(creditsSummaryProvider);
      ref.invalidate(allCataloguesProvider);
      ref.invalidate(userCataloguesProvider);
      return result;
    } on AppException catch (e) {
      if (ref.mounted) {
        final message = _messageOf(e);
        state = state.copyWith(
          isSubmitting: false,
          errorMessage: message,
          rejectedRowId: _rowIdFromMessage(message),
        );
      }
      rethrow;
    }
  }

  Map<String, dynamic> _payloadFor(
    BatchRowState r, {
    required GarmentType garmentType,
    required List<PoseModel> poses,
  }) {
    final needs = requiredInputsForPoses(
      poses.where((p) => r.poseIds.contains(p.id)),
    );
    return {
      'upperGarmentKey': r.upperGarmentKey,
      'faceId': r.faceId,
      'backgroundId': r.backgroundId,
      'poseIds': r.poseIds.toList(),
      if (needs.needsLower && r.lowerCatalogItemId != null)
        'lowerCatalogId': r.lowerCatalogItemId,
      if (garmentType.requiresLowerUpload && r.lowerGarmentKey != null)
        'lowerGarmentKey': r.lowerGarmentKey,
      if (needs.needsShoes && r.shoeCatalogItemId != null)
        'shoeCatalogId': r.shoeCatalogItemId,
    };
  }

  /// The API attributes a row-scoped rejection as "Row N: …" (see
  /// `submitBatch` in jobs_api.dart); map N back to the row that was sent.
  String? _rowIdFromMessage(String message) {
    final match = RegExp(r'^Row (\d+):').firstMatch(message);
    if (match == null) return null;
    final index = int.parse(match.group(1)!) - 1;
    return index >= 0 && index < state.rows.length ? state.rows[index].id : null;
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

/// Auto-disposed so leaving the Batch flow discards the grid — a stale,
/// half-filled grid reappearing next time would be surprising. Both batch
/// pages watch it, so it lives exactly as long as the flow is open.
final batchSelectionControllerProvider =
    NotifierProvider.autoDispose<BatchSelectionController, BatchSelectionState>(
      BatchSelectionController.new,
    );

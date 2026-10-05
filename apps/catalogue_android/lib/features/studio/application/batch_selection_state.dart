import 'package:freezed_annotation/freezed_annotation.dart';

import '../data/models/garment_type.dart';
import '../data/models/gender.dart';

part 'batch_selection_state.freezed.dart';

/// One card in the grid — one complete look: its own garment upload, face,
/// background, poses and optional lower/shoe. Mirrors `BatchRowInputs` in
/// `packages/types/src/batch.ts`. Local UI state only (never serialized
/// directly — [BatchSelectionController.submit] builds the wire payload).
///
/// Whether a row is *complete* depends on the garment type and the poses'
/// lower/shoe requirements, so that lives in `batch_validation.dart`.
@freezed
abstract class BatchRowState with _$BatchRowState {
  const factory BatchRowState({
    required String id,
    String? upperGarmentKey,
    String? localImagePath,
    @Default(false) bool isUploadingGarment,
    String? garmentError,
    String? faceId,
    String? backgroundId,
    @Default(<String>{}) Set<String> poseIds,
    String? lowerCatalogItemId,
    String? shoeCatalogItemId,
    String? lowerGarmentKey,
    String? localLowerImagePath,
    @Default(false) bool isUploadingLowerGarment,
    String? lowerGarmentError,
  }) = _BatchRowState;

  const BatchRowState._();

  /// True once the user has put anything into the row — used to decide
  /// whether throwing the grid away needs a confirmation.
  bool get hasWork =>
      localImagePath != null ||
      upperGarmentKey != null ||
      faceId != null ||
      backgroundId != null ||
      poseIds.isNotEmpty ||
      lowerCatalogItemId != null ||
      shoeCatalogItemId != null ||
      localLowerImagePath != null;
}

@freezed
abstract class BatchSelectionState with _$BatchSelectionState {
  const factory BatchSelectionState({
    @Default(Gender.women) Gender gender,
    GarmentType? garmentType,
    @Default('Amazon') String platform,
    @Default('1:1') String aspectRatio,
    @Default('2K') String resolution,
    @Default(<BatchRowState>[]) List<BatchRowState> rows,
    @Default(false) bool isSubmitting,
    String? errorMessage,

    /// The row the server named in its last rejection, so the grid can mark it.
    String? rejectedRowId,
  }) = _BatchSelectionState;

  const BatchSelectionState._();

  bool get hasWork => rows.any((r) => r.hasWork);

  /// Rows that carry a garment photo (uploading, uploaded or failed) — what
  /// the upload tray on the first page shows.
  List<BatchRowState> get garmentRows =>
      rows.where((r) => r.localImagePath != null).toList();
}

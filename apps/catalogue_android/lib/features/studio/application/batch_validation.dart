import '../data/models/garment_type.dart';
import '../data/models/pose_model.dart';
import 'batch_selection_state.dart';

/// Schema ceiling on rows (`MAX_BATCH_ROWS`, packages/types/src/batch.ts).
const kMaxBatchRows = 100;

/// The web app's client-side cap on total images (`DEFAULT_MAX_BATCH_JOBS`).
/// The operative limit is admin-configured server-side and is enforced there
/// too; this only lets the screen say so before submitting.
const kMaxBatchJobs = 200;

/// The aspect ratios batch mode offers — the web app narrows the API's wider
/// enum to these four because batch has no way to correct an unsupported one.
const kBatchAspectRatios = ['1:1', '2:3', '3:4', '4:5'];

/// Largest garment photo the upload tray accepts.
const kMaxGarmentBytes = 10 * 1024 * 1024;

/// Which optional inputs a pose selection requires — the same rule as
/// `requiredInputsForPoses` in packages/types/src/batch.ts, which is what the
/// API validates against: a selection needs an input if ANY selected pose's
/// workflow has that node.
({bool needsLower, bool needsShoes}) requiredInputsForPoses(
  Iterable<PoseModel> poses,
) => (
  needsLower: poses.any((p) => p.hasLower),
  needsShoes: poses.any((p) => p.hasShoes),
);

/// What [row] is still missing; empty means it can be submitted.
List<String> batchRowIssues(
  BatchRowState row, {
  required GarmentType garmentType,
  required List<PoseModel> poses,
}) {
  final issues = <String>[];
  if (row.isUploadingGarment) {
    issues.add('garment uploading');
  } else if (row.garmentError != null) {
    issues.add('garment upload failed');
  } else if (row.upperGarmentKey == null) {
    issues.add('garment');
  }

  if (garmentType.requiresLowerUpload) {
    if (row.isUploadingLowerGarment) {
      issues.add('bottom wear uploading');
    } else if (row.lowerGarmentError != null) {
      issues.add('bottom wear upload failed');
    } else if (row.lowerGarmentKey == null) {
      issues.add('bottom wear');
    }
  }

  if (row.faceId == null) issues.add('model');
  if (row.backgroundId == null) issues.add('background');
  if (row.poseIds.isEmpty) issues.add('pose');

  final selected = poses.where((p) => row.poseIds.contains(p.id));
  final needs = requiredInputsForPoses(selected);
  if (needs.needsLower &&
      row.lowerCatalogItemId == null &&
      row.lowerGarmentKey == null) {
    issues.add('lower garment');
  }
  if (needs.needsShoes && row.shoeCatalogItemId == null) issues.add('shoes');
  return issues;
}

/// Total images a batch will create — one per pose per row.
int countBatchJobs(Iterable<BatchRowState> rows) =>
    rows.fold(0, (total, row) => total + row.poseIds.length);

/// Rows that still have something missing.
List<BatchRowState> invalidBatchRows(
  List<BatchRowState> rows, {
  required GarmentType garmentType,
  required List<PoseModel> poses,
}) => [
  for (final row in rows)
    if (batchRowIssues(row, garmentType: garmentType, poses: poses).isNotEmpty)
      row,
];

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/core/network/app_exception.dart';
import 'package:aicatalogueflutter/features/studio/application/batch_selection_controller.dart';
import 'package:aicatalogueflutter/features/studio/application/batch_selection_state.dart';
import 'package:aicatalogueflutter/features/studio/application/batch_validation.dart';
import 'package:aicatalogueflutter/features/studio/application/studio_providers.dart';
import 'package:aicatalogueflutter/features/studio/data/models/batch_submit_result.dart';
import 'package:aicatalogueflutter/features/studio/data/models/garment_type.dart';
import 'package:aicatalogueflutter/features/studio/data/models/pose_model.dart';
import 'package:aicatalogueflutter/features/studio/data/repositories/studio_repository.dart';

const _shirt = GarmentType(
  id: 'gt-shirt',
  slug: 'shirt',
  label: 'Shirt',
  sortOrder: 1,
);
const _coord = GarmentType(
  id: 'gt-coord',
  slug: 'coord',
  label: 'Co-ord',
  sortOrder: 2,
  requiresLowerUpload: true,
);

const _plain = PoseModel(id: 'p-plain', label: 'Plain', thumbnailUrl: '');
const _withLower = PoseModel(
  id: 'p-lower',
  label: 'Lower',
  thumbnailUrl: '',
  hasLower: true,
);
const _withShoes = PoseModel(
  id: 'p-shoes',
  label: 'Shoes',
  thumbnailUrl: '',
  hasShoes: true,
);
const _poses = [_plain, _withLower, _withShoes];

BatchRowState _complete({Set<String> poseIds = const {'p-plain'}}) =>
    BatchRowState(
      id: 'r',
      upperGarmentKey: 'garment/key',
      faceId: 'face',
      backgroundId: 'bg',
      poseIds: poseIds,
    );

/// Records what `submitBatch` was called with; everything else is unused here.
class _FakeRepo implements StudioRepository {
  Map<String, dynamic>? sent;

  @override
  Future<BatchSubmitResult> submitBatch({
    required String garmentTypeId,
    required String aspectRatio,
    required String resolution,
    String? platform,
    Map<String, dynamic>? params,
    String? userHint,
    required List<Map<String, dynamic>> rows,
  }) async {
    sent = {
      'garmentTypeId': garmentTypeId,
      'aspectRatio': aspectRatio,
      'resolution': resolution,
      'platform': platform,
      'rows': rows,
    };
    return const BatchSubmitResult(
      batchId: 'b',
      totalJobs: 1,
      creditsCharged: 1,
      catalogues: [],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('batchRowIssues', () {
    test('a fresh row is missing everything the API requires', () {
      final issues = batchRowIssues(
        const BatchRowState(id: 'r'),
        garmentType: _shirt,
        poses: _poses,
      );
      expect(issues, ['garment', 'model', 'background', 'pose']);
    });

    test('a finished row has no issues', () {
      expect(
        batchRowIssues(_complete(), garmentType: _shirt, poses: _poses),
        isEmpty,
      );
    });

    test('an in-flight or failed upload is not a finished garment', () {
      final uploading = _complete().copyWith(
        upperGarmentKey: null,
        isUploadingGarment: true,
      );
      final failed = _complete().copyWith(
        upperGarmentKey: null,
        garmentError: 'Upload failed',
      );
      expect(
        batchRowIssues(uploading, garmentType: _shirt, poses: _poses),
        ['garment uploading'],
      );
      expect(
        batchRowIssues(failed, garmentType: _shirt, poses: _poses),
        ['garment upload failed'],
      );
    });

    test('poses that need a lower garment or shoes require them', () {
      final row = _complete(poseIds: {'p-lower', 'p-shoes'});
      expect(
        batchRowIssues(row, garmentType: _shirt, poses: _poses),
        ['lower garment', 'shoes'],
      );
      expect(
        batchRowIssues(
          row.copyWith(lowerCatalogItemId: 'l', shoeCatalogItemId: 's'),
          garmentType: _shirt,
          poses: _poses,
        ),
        isEmpty,
      );
    });

    test('a garment type that needs a bottom-wear photo requires it', () {
      final row = _complete();
      expect(
        batchRowIssues(row, garmentType: _coord, poses: _poses),
        ['bottom wear'],
      );
      expect(
        batchRowIssues(
          row.copyWith(lowerGarmentKey: 'lower/key'),
          garmentType: _coord,
          poses: _poses,
        ),
        isEmpty,
      );
    });

    test('total images is one per pose per row', () {
      expect(
        countBatchJobs([
          _complete(poseIds: {'a', 'b', 'c'}),
          _complete(poseIds: {'d'}),
        ]),
        4,
      );
    });
  });

  group('BatchSelectionController', () {
    late _FakeRepo repo;
    late ProviderContainer container;
    late BatchSelectionController controller;

    setUp(() {
      repo = _FakeRepo();
      container = ProviderContainer(
        overrides: [studioRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);
      // autoDispose: keep it alive for the test's duration.
      container.listen(batchSelectionControllerProvider, (_, _) {});
      controller = container.read(batchSelectionControllerProvider.notifier);
    });

    BatchSelectionState state() =>
        container.read(batchSelectionControllerProvider);

    test('starts with a single empty row', () {
      expect(state().rows, hasLength(1));
      expect(state().hasWork, isFalse);
    });

    test('changing the garment type clears every row', () {
      controller.selectGarmentType(_shirt);
      controller.selectRowFace(state().rows.first.id, 'face');
      expect(state().hasWork, isTrue);

      controller.selectGarmentType(_coord);
      expect(state().rows, hasLength(1));
      expect(state().hasWork, isFalse);
      expect(state().garmentType?.id, 'gt-coord');
    });

    test('duplicating a row inserts the copy right after it', () {
      controller.addRow();
      controller.addRow();
      final ids = state().rows.map((r) => r.id).toList();
      controller.selectRowFace(ids.first, 'face');

      controller.duplicateRow(ids.first);

      final after = state().rows;
      expect(after, hasLength(4));
      expect(after[0].id, ids.first);
      expect(after[1].faceId, 'face');
      expect(after[1].id, isNot(ids.first));
      expect(after[2].id, ids[1]);
    });

    test('removing the last row leaves a fresh empty one', () {
      final only = state().rows.single.id;
      controller.removeRow(only);
      expect(state().rows, hasLength(1));
      expect(state().rows.single.id, isNot(only));
    });

    test('changing poses drops a lower/shoe choice they no longer need', () {
      final id = state().rows.single.id;
      controller.setRowPoses(id, {'p-lower', 'p-shoes'}, _poses);
      controller.selectRowLowerCatalogItem(id, 'l');
      controller.selectRowShoeCatalogItem(id, 's');

      controller.setRowPoses(id, {'p-lower'}, _poses);
      expect(state().rows.single.lowerCatalogItemId, 'l');
      expect(state().rows.single.shoeCatalogItemId, isNull);

      controller.setRowPoses(id, {'p-plain'}, _poses);
      expect(state().rows.single.lowerCatalogItemId, isNull);
    });

    test('apply-to-all sets the field on every row', () {
      controller.addRow();
      controller.applyFaceToAll('face-x');
      controller.applyPosesToAll({'p-plain'}, _poses);
      expect(state().rows.every((r) => r.faceId == 'face-x'), isTrue);
      expect(state().rows.every((r) => r.poseIds.length == 1), isTrue);
    });

    test('submit refuses an incomplete grid and sends nothing', () async {
      controller.selectGarmentType(_shirt);
      await expectLater(
        controller.submit(poses: _poses),
        throwsA(isA<BadRequestException>()),
      );
      expect(repo.sent, isNull);
    });

    test('submit sends every row, with lower/shoes only where needed', () async {
      controller.selectGarmentType(_shirt);
      controller.selectResolution('HD');
      controller.selectPlatform('Myntra');
      final first = state().rows.single.id;
      controller.addRow();
      final second = state().rows.last.id;

      for (final id in [first, second]) {
        controller.selectRowFace(id, 'face-$id');
        controller.selectRowBackground(id, 'bg-$id');
      }
      controller.setRowPoses(first, {'p-plain'}, _poses);
      controller.setRowPoses(second, {'p-lower'}, _poses);
      controller.selectRowLowerCatalogItem(second, 'lower-1');
      // A stale shoe choice on a row whose poses don't need shoes.
      controller.selectRowShoeCatalogItem(first, 'shoe-stale');
      // Garments are uploaded (keys set) via the state directly: uploads go
      // through the network layer, which isn't what is under test here.
      controller.state = state().copyWith(
        rows: [
          for (final r in state().rows)
            r.copyWith(upperGarmentKey: 'key-${r.id}'),
        ],
      );

      final result = await controller.submit(poses: _poses);

      expect(result.batchId, 'b');
      expect(repo.sent!['garmentTypeId'], 'gt-shirt');
      expect(repo.sent!['resolution'], 'HD');
      expect(repo.sent!['platform'], 'Myntra');
      final rows = repo.sent!['rows'] as List<Map<String, dynamic>>;
      expect(rows, hasLength(2));
      expect(rows[0]['upperGarmentKey'], 'key-$first');
      expect(rows[0].containsKey('shoeCatalogId'), isFalse);
      expect(rows[0].containsKey('lowerCatalogId'), isFalse);
      expect(rows[1]['lowerCatalogId'], 'lower-1');
    });

    test("'Amazon' is not sent as a platform (needs a white bg server-side)",
        () async {
      controller.selectGarmentType(_shirt);
      final id = state().rows.single.id;
      controller.selectRowFace(id, 'f');
      controller.selectRowBackground(id, 'b');
      controller.setRowPoses(id, {'p-plain'}, _poses);
      controller.state = state().copyWith(
        rows: [state().rows.single.copyWith(upperGarmentKey: 'k')],
      );

      await controller.submit(poses: _poses);
      expect(repo.sent!['platform'], isNull);
    });
  });
}

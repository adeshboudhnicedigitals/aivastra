import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/features/studio/application/catalogue_cost.dart';
import 'package:aicatalogueflutter/features/studio/application/catalogue_selection_state.dart';
import 'package:aicatalogueflutter/features/studio/data/models/resolutions_config.dart';

const _config = ResolutionsConfig(
  resolutions: {
    'HD': ResolutionInfo(enabled: false, creditCost: 25, longEdgePx: 1024),
    '2K': ResolutionInfo(enabled: true, creditCost: 35, longEdgePx: 2048),
    '4K': ResolutionInfo(enabled: true, creditCost: 40, longEdgePx: 4096),
  },
);

void main() {
  group('imageCountFor', () {
    test('Create Your Own counts the selected poses', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1', 'p2', 'p3'},
        selectedLookIds: {'irrelevant-in-this-mode'},
      );
      expect(imageCountFor(selection), 3);
    });

    test('Ready-Made counts the kept looks, not the raw pose set', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.readyMade,
        poseIds: {'irrelevant-in-this-mode'},
        selectedLookIds: {'l1', 'l2'},
      );
      expect(imageCountFor(selection), 2);
    });

    test('zero when nothing is selected yet', () {
      const selection = CatalogueSelectionState();
      expect(imageCountFor(selection), 0);
    });
  });

  group('creditsForSelection', () {
    test('multiplies the resolution cost by the pose count — the actual bug', () {
      // 3 poses at 2K (35 credits each) must show 105, not a flat 10/35.
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1', 'p2', 'p3'},
        resolution: '2K',
      );
      expect(creditsForSelection(selection, _config), 105);
    });

    test('a single pose still charges exactly one image', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1'},
        resolution: '2K',
      );
      expect(creditsForSelection(selection, _config), 35);
    });

    test('follows the chosen resolution tier', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1', 'p2'},
        resolution: '4K',
      );
      expect(creditsForSelection(selection, _config), 80);
    });

    test('Ready-Made multiplies by kept looks, not by raw pose count', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.readyMade,
        poseIds: {'a', 'b', 'c', 'd'}, // stale/irrelevant in this mode
        selectedLookIds: {'l1', 'l2'},
        resolution: '2K',
      );
      expect(creditsForSelection(selection, _config), 70);
    });

    test('falls back to the web app\'s known resolution costs when config is null', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1', 'p2'},
        resolution: '4K',
      );
      expect(creditsForSelection(selection, null), 80);
    });

    test('an unconfigured resolution key still resolves via the fallback map', () {
      const selection = CatalogueSelectionState(
        lookMode: LookMode.createYourOwn,
        poseIds: {'p1'},
        resolution: 'HD',
      );
      // Server hasn't loaded config yet, HD isn't in it either way.
      expect(creditsForSelection(selection, const ResolutionsConfig(resolutions: {})), 25);
    });
  });
}

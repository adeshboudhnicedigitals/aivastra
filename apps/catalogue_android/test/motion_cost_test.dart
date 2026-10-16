import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/features/studio/application/motion_cost.dart';
import 'package:aicatalogueflutter/features/studio/data/models/sample_video.dart';

const _pricing = PixversePricing(
  perSecondRate: {'360p': 2, '540p': 4, '720p': 10, '1080p': 20},
  qualityBase: {'360p': 20, '540p': 40, '720p': 60, '1080p': 100},
);

void main() {
  group('computePixverseVideoCost', () {
    test('adds the quality tier base to duration times its per-second rate', () {
      expect(computePixverseVideoCost(5, '720p', _pricing), 60 + 5 * 10);
      expect(computePixverseVideoCost(15, '1080p', _pricing), 100 + 15 * 20);
    });

    test('a default-style config (zero per-second, flat 150 base) still charges 150', () {
      // Matches DEFAULT_PIXVERSE_VIDEO_PRICING (apps/api/src/lib/resolution-config.ts):
      // perSecondRate all 0, qualityBase all PIXVERSE_VIDEO_COST (150) — the actual bug
      // this covers: the button previously showed a flat "10 Credits" regardless.
      const defaultPricing = PixversePricing(
        perSecondRate: {'360p': 0, '540p': 0, '720p': 0, '1080p': 0},
        qualityBase: {'360p': 150, '540p': 150, '720p': 150, '1080p': 150},
      );
      expect(computePixverseVideoCost(10, '720p', defaultPricing), 150);
      expect(computePixverseVideoCost(5, '1080p', defaultPricing), 150);
    });

    test('falls back to 1 credit when the tier is missing from the config', () {
      const sparse = PixversePricing(
        perSecondRate: {'720p': 10},
        qualityBase: {'720p': 60},
      );
      expect(computePixverseVideoCost(5, '1080p', sparse), 1);
    });
  });

  group('creditsForMotionVideo', () {
    test('computes live from duration + quality once pricing has loaded', () {
      expect(
        creditsForMotionVideo(
          duration: 10,
          quality: '720p',
          pricing: _pricing,
          selectedSampleCreditCost: 999, // must be ignored once pricing exists
        ),
        60 + 10 * 10,
      );
    });

    test('falls back to the selected preset\'s own creditCost before pricing loads', () {
      expect(
        creditsForMotionVideo(
          duration: 10,
          quality: '720p',
          pricing: null,
          selectedSampleCreditCost: 150,
        ),
        150,
      );
    });

    test('null with nothing to show yet (no pricing, no preset selected)', () {
      expect(
        creditsForMotionVideo(
          duration: 10,
          quality: '720p',
          pricing: null,
          selectedSampleCreditCost: null,
        ),
        null,
      );
    });
  });
}

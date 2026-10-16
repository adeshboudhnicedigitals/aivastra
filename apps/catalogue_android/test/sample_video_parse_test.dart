import 'package:aicatalogueflutter/features/studio/data/models/sample_video.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('motion presets still parse when admin pricing has bad values', () {
    final response = SampleVideosResponse.fromJson({
      'items': [
        {
          'id': 'a',
          'title': 'Walk',
          'prompt': 'walks',
          'thumbnailUrl': 'https://x/t.jpg',
          'previewVideoUrl': 'https://x/v.mp4',
          'duration': 8,
          'quality': '720p',
          'creditCost': 10,
        },
      ],
      'pixverseVideoPricing': {
        // Same shape as qualityBase — a map per quality tier
        // (apps/api/src/lib/resolution-config.ts's PixverseVideoPricingConfig),
        // not one number shared by every tier.
        'perSecondRate': {'360p': 1, '540p': '1.5', '720p': null, '1080p': ''},
        'qualityBase': {'360p': 10, '540p': '12', '720p': null, '1080p': ''},
      },
    });
    expect(response.items, hasLength(1));
    expect(response.pixverseVideoPricing!.perSecondRate, {
      '360p': 1,
      '540p': 1.5,
    });
    expect(response.pixverseVideoPricing!.qualityBase, {
      '360p': 10,
      '540p': 12,
    });
  });
}

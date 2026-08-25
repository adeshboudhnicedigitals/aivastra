import { describe, expect, it } from 'vitest';
import { computePixverseVideoCost, type PixverseVideoPricingConfig } from './jobs.js';

describe('computePixverseVideoCost', () => {
  const config: PixverseVideoPricingConfig = {
    perSecondRate: 10,
    qualityBase: { '360p': 20, '540p': 40, '720p': 60, '1080p': 100 },
  };

  it('adds quality base to duration * per-second rate', () => {
    expect(computePixverseVideoCost(5, '720p', config)).toBe(60 + 5 * 10);
    expect(computePixverseVideoCost(15, '1080p', config)).toBe(100 + 15 * 10);
  });

  it('rounds fractional totals up', () => {
    const fractional: PixverseVideoPricingConfig = {
      perSecondRate: 0.5,
      qualityBase: { '360p': 1, '540p': 1, '720p': 1, '1080p': 1 },
    };
    // 1 + 3 * 0.5 = 2.5 -> 3
    expect(computePixverseVideoCost(3, '360p', fractional)).toBe(3);
  });

  it('floors the result at 1 credit even if the formula computes to 0 or less', () => {
    const zeroed: PixverseVideoPricingConfig = {
      perSecondRate: 0,
      qualityBase: { '360p': 0, '540p': 0, '720p': 0, '1080p': 0 },
    };
    expect(computePixverseVideoCost(1, '360p', zeroed)).toBe(1);
  });

  it('duration=1 and duration=15 (API boundary values) both compute correctly', () => {
    expect(computePixverseVideoCost(1, '540p', config)).toBe(40 + 1 * 10);
    expect(computePixverseVideoCost(15, '540p', config)).toBe(40 + 15 * 10);
  });
});

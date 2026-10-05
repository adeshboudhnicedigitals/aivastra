import { describe, expect, it } from 'vitest';
import {
  ASPECT_RATIOS,
  CreateTryOnJobInputsBase,
  computeOutputDims,
  computePixverseVideoCost,
  type PixverseVideoPricingConfig,
} from './jobs.js';

describe('computePixverseVideoCost', () => {
  const config: PixverseVideoPricingConfig = {
    perSecondRate: { '360p': 2, '540p': 4, '720p': 10, '1080p': 20 },
    qualityBase: { '360p': 20, '540p': 40, '720p': 60, '1080p': 100 },
  };

  it("adds quality base to duration * that quality's per-second rate", () => {
    expect(computePixverseVideoCost(5, '720p', config)).toBe(60 + 5 * 10);
    expect(computePixverseVideoCost(15, '1080p', config)).toBe(100 + 15 * 20);
    expect(computePixverseVideoCost(5, '360p', config)).toBe(20 + 5 * 2);
  });

  it('rounds fractional totals up', () => {
    const fractional: PixverseVideoPricingConfig = {
      perSecondRate: { '360p': 0.5, '540p': 0.5, '720p': 0.5, '1080p': 0.5 },
      qualityBase: { '360p': 1, '540p': 1, '720p': 1, '1080p': 1 },
    };
    // 1 + 3 * 0.5 = 2.5 -> 3
    expect(computePixverseVideoCost(3, '360p', fractional)).toBe(3);
  });

  it('floors the result at 1 credit even if the formula computes to 0 or less', () => {
    const zeroed: PixverseVideoPricingConfig = {
      perSecondRate: { '360p': 0, '540p': 0, '720p': 0, '1080p': 0 },
      qualityBase: { '360p': 0, '540p': 0, '720p': 0, '1080p': 0 },
    };
    expect(computePixverseVideoCost(1, '360p', zeroed)).toBe(1);
  });

  it('duration=1 and duration=15 (API boundary values) both compute correctly', () => {
    expect(computePixverseVideoCost(1, '540p', config)).toBe(40 + 1 * 4);
    expect(computePixverseVideoCost(15, '540p', config)).toBe(40 + 15 * 4);
  });

  it('falls back to 1 credit instead of NaN when qualityBase is missing the requested tier', () => {
    const malformed: PixverseVideoPricingConfig = {
      perSecondRate: { '360p': 0, '540p': 0, '720p': 0, '1080p': 0 },
      qualityBase: {} as PixverseVideoPricingConfig['qualityBase'],
    };
    expect(computePixverseVideoCost(8, '720p', malformed)).toBe(1);
  });
});

describe('computeOutputDims', () => {
  it('puts the long edge on width for a landscape ratio (16:9)', () => {
    expect(computeOutputDims('16:9', 3200)).toEqual({ width: 3200, height: 1800 });
  });

  it('puts the long edge on height for a portrait ratio (2:3)', () => {
    expect(computeOutputDims('2:3', 3200)).toEqual({ width: 2133, height: 3200 });
  });

  it('keeps width and height equal for a square ratio (1:1)', () => {
    expect(computeOutputDims('1:1', 3200)).toEqual({ width: 3200, height: 3200 });
  });

  it('handles the portrait 9:16 ratio (no longer a client-only special case)', () => {
    expect(computeOutputDims('9:16', 4096)).toEqual({ width: 2304, height: 4096 });
  });

  it('throws on an unknown ratio', () => {
    expect(() => computeOutputDims('7:3', 2688)).toThrow('Unknown aspect ratio: 7:3');
  });

  it('every ratio used by CreateTryOnJobRequest has a formula entry', () => {
    for (const r of ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9']) {
      expect(ASPECT_RATIOS[r]).toBeDefined();
    }
  });
});

describe('CreateTryOnJobInputsBase accessoryCatalogIds', () => {
  it('accepts an array of uuids', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
      accessoryCatalogIds: ['44444444-4444-4444-4444-444444444444'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessoryCatalogIds).toEqual(['44444444-4444-4444-4444-444444444444']);
    }
  });

  it('rejects a non-uuid entry', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
      accessoryCatalogIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('is optional', () => {
    const result = CreateTryOnJobInputsBase.safeParse({
      faceId: '11111111-1111-1111-1111-111111111111',
      backgroundId: '22222222-2222-2222-2222-222222222222',
      poseIds: ['33333333-3333-3333-3333-333333333333'],
    });
    expect(result.success).toBe(true);
  });
});

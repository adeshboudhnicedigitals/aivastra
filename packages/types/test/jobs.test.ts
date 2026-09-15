import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS, computeOutputDims } from '../src/jobs.js';

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

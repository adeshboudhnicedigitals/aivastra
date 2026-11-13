import { describe, expect, it } from 'vitest';
import { pctChange, pointsChange } from './delta';

describe('pctChange', () => {
  it('is null without a baseline or a current value', () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(5, null)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
  });
  it('reads a rise as good by default and a drop as good when lower is better', () => {
    expect(pctChange(15, 10)).toEqual({ text: '+50%', positive: true });
    expect(pctChange(5, 10)).toEqual({ text: '-50%', positive: false });
    expect(pctChange(5, 10, true)).toEqual({ text: '-50%', positive: true });
    expect(pctChange(15, 10, true)).toEqual({ text: '+50%', positive: false });
  });
});

describe('pointsChange', () => {
  it('reports percentage points, and compares against a zero rate', () => {
    expect(pointsChange(0.12, 0.1)).toEqual({ text: '+2 percentage points', positive: true });
    expect(pointsChange(0.1, 0)).toEqual({ text: '+10 percentage points', positive: true });
    expect(pointsChange(0.12, 0.1, true)?.positive).toBe(false);
    expect(pointsChange(null, 0.1)).toBeNull();
  });
});

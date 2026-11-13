import { describe, expect, it } from 'vitest';
import { heatGrid, heatLevel, hourLabel, peakLabel } from './heat-scale';

describe('heatLevel', () => {
  it('is 0 only for a true zero, and any activity is at least step 1', () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 1000)).toBe(1);
    expect(heatLevel(100, 100)).toBe(5);
    expect(heatLevel(50, 100)).toBe(3);
  });
  it('never returns NaN or out-of-range steps', () => {
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(Number.NaN, 10)).toBe(0);
    expect(heatLevel(-3, 10)).toBe(0);
    expect(heatLevel(20, 10)).toBe(5);
  });
});

describe('heatGrid', () => {
  it('puts Monday first and Sunday last, zero-filling missing cells', () => {
    const grid = heatGrid([
      { weekday: 0, hour: 10, value: 4 },
      { weekday: 1, hour: 0, value: 2 },
    ]);
    expect(grid).toHaveLength(7);
    expect(grid.every((r) => r.length === 24)).toBe(true);
    expect(grid[0]?.[0]).toBe(2);
    expect(grid[6]?.[10]).toBe(4);
    expect(grid[3]?.[5]).toBe(0);
  });
});

describe('labels', () => {
  it('formats hours as a 12-hour clock', () => {
    expect([0, 9, 12, 18, 23].map(hourLabel)).toEqual(['12 AM', '9 AM', '12 PM', '6 PM', '11 PM']);
  });
  it('names the busiest cell, or null for an empty grid', () => {
    expect(peakLabel(heatGrid([{ weekday: 6, hour: 18, value: 9 }]))).toBe('Sat 6 PM');
    expect(peakLabel(heatGrid([]))).toBeNull();
  });
});

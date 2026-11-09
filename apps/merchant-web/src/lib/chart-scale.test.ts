import { describe, expect, it } from 'vitest';
import { formatCredits, formatRatio, scaleSeries } from './chart-scale';

describe('scaleSeries', () => {
  it('maps all zeros to zeros', () => {
    expect(scaleSeries([0, 0, 0], 100)).toEqual([0, 0, 0]);
  });
  it('handles an empty series', () => {
    expect(scaleSeries([], 100)).toEqual([]);
  });
  it('handles a single point', () => {
    expect(scaleSeries([7], 80)).toEqual([80]);
  });
  it('maps the max to full height and scales proportionally', () => {
    expect(scaleSeries([0, 5, 10], 100)).toEqual([0, 50, 100]);
  });
  it('stays finite for huge numbers', () => {
    const out = scaleSeries([1e15, 5e14], 100);
    expect(out).toEqual([100, 50]);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
  it('treats negative or non-finite values as zero', () => {
    expect(scaleSeries([-3, Number.NaN, 4], 10)).toEqual([0, 0, 10]);
  });
});

describe('formatRatio', () => {
  it('is 0% with no sessions', () => expect(formatRatio(0, 0)).toBe('0%'));
  it('is 0% with no sessions even if sold is set', () => expect(formatRatio(3, 0)).toBe('0%'));
  it('uses at most one decimal', () => {
    expect(formatRatio(1, 3)).toBe('33.3%');
    expect(formatRatio(1, 8)).toBe('12.5%');
  });
  it('drops a trailing .0', () => {
    expect(formatRatio(1, 2)).toBe('50%');
    expect(formatRatio(5, 5)).toBe('100%');
  });
  it('allows above 100%', () => expect(formatRatio(3, 2)).toBe('150%'));
});

describe('formatCredits', () => {
  it('uses en-IN grouping', () => {
    expect(formatCredits(0)).toBe('0');
    expect(formatCredits(1234)).toBe('1,234');
    expect(formatCredits(1234567)).toBe('12,34,567');
  });
  it('rounds to an integer', () => expect(formatCredits(12.6)).toBe('13'));
});

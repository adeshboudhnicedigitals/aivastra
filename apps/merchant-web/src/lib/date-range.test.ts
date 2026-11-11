import { describe, expect, it } from 'vitest';
import { isValidCustomRange, previousRange, rangeFor } from './date-range';

const TZ = 'Asia/Kolkata';

describe('rangeFor', () => {
  // 19:00Z on 6 Nov is 00:30 on 7 Nov in IST.
  const now = new Date('2026-11-06T19:00:00Z');
  it('today uses the local date in tz, not UTC', () => {
    expect(rangeFor('today', now, TZ)).toEqual({ from: '2026-11-07', to: '2026-11-07' });
  });
  it('7d is today and the 6 days before', () => {
    expect(rangeFor('7d', now, TZ)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
  });
  it('30d is today and the 29 days before, across a month boundary', () => {
    expect(rangeFor('30d', now, TZ)).toEqual({ from: '2026-10-09', to: '2026-11-07' });
  });
  it('before the boundary the local date is still the previous day', () => {
    expect(rangeFor('today', new Date('2026-11-06T18:00:00Z'), TZ)).toEqual({
      from: '2026-11-06',
      to: '2026-11-06',
    });
  });
  it('crosses a year boundary and a leap day', () => {
    expect(rangeFor('7d', new Date('2027-01-03T06:00:00Z'), TZ).from).toBe('2026-12-28');
    expect(rangeFor('30d', new Date('2028-03-10T06:00:00Z'), TZ).from).toBe('2028-02-10');
  });
});

describe('isValidCustomRange', () => {
  it('accepts equal dates', () => {
    expect(isValidCustomRange('2026-11-07', '2026-11-07')).toBeNull();
  });
  it('rejects from after to', () => {
    expect(isValidCustomRange('2026-11-08', '2026-11-07')).toMatch(/before/i);
  });
  it('accepts 366 days inclusive and rejects 367', () => {
    expect(isValidCustomRange('2026-01-01', '2026-12-31')).toBeNull(); // 365 days
    expect(isValidCustomRange('2028-01-01', '2028-12-31')).toBeNull(); // 366 days, leap year
    expect(isValidCustomRange('2027-01-01', '2028-01-02')).toMatch(/366/);
  });
  it('rejects malformed or empty input', () => {
    expect(isValidCustomRange('', '2026-11-07')).not.toBeNull();
    expect(isValidCustomRange('2026-11-07', 'nope')).not.toBeNull();
    expect(isValidCustomRange('2026-02-30', '2026-03-01')).not.toBeNull();
  });
});

describe('previousRange', () => {
  it('is the equally long run of days just before the range', () => {
    expect(previousRange({ from: '2026-11-01', to: '2026-11-07' })).toEqual({
      from: '2026-10-25',
      to: '2026-10-31',
    });
  });

  it('handles a single day', () => {
    expect(previousRange({ from: '2026-11-07', to: '2026-11-07' })).toEqual({
      from: '2026-11-06',
      to: '2026-11-06',
    });
  });
});

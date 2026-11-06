import { describe, expect, it } from 'vitest';
import { formatCountdown } from './countdown';

describe('formatCountdown', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatCountdown(15 * 60_000)).toBe('15:00');
    expect(formatCountdown(14 * 60_000 + 59_000)).toBe('14:59');
    expect(formatCountdown(65_000)).toBe('1:05');
  });
  it('rounds a partial second up so it never shows 0:00 while time remains', () => {
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
  });
  it('clamps at zero and reports Expired', () => {
    expect(formatCountdown(0)).toBe('Expired');
    expect(formatCountdown(-5000)).toBe('Expired');
    expect(formatCountdown(Number.NaN)).toBe('Expired');
  });
});

import { describe, expect, it } from 'vitest';
import { pct, perUnit, stepPct, waitText } from './insights';

describe('insights formatting', () => {
  it('formats ratios and guards empty divisors', () => {
    expect(pct(0.25)).toBe('25%');
    expect(pct(2 / 7)).toBe('28.6%');
    expect(pct(null)).toBe('—');
    expect(stepPct(3, 7)).toBe('42.9%');
    expect(stepPct(0, 0)).toBe('—');
  });
  it('formats waits', () => {
    expect(waitText(null)).toBe('—');
    expect(waitText(20000)).toBe('20 s');
    expect(waitText(28400)).toBe('28.4 s');
    expect(waitText(90000)).toBe('1.5 min');
  });
  it('formats credits per unit', () => {
    expect(perUnit(null)).toBe('—');
    expect(perUnit(1.3333)).toBe('1.3');
    expect(perUnit(4)).toBe('4');
  });
});

import { describe, expect, it } from 'vitest';
import { staffLimitState } from './staff-limit';

describe('staffLimitState', () => {
  it('under limit', () => {
    expect(staffLimitState(1, 2)).toEqual({ label: '1 of 2', atLimit: false });
  });
  it('at limit', () => {
    expect(staffLimitState(2, 2).atLimit).toBe(true);
  });
  it('over limit after a limit decrease', () => {
    expect(staffLimitState(3, 2)).toEqual({ label: '3 of 2', atLimit: true });
  });
  it('zero limit', () => {
    expect(staffLimitState(0, 0).atLimit).toBe(true);
  });
});

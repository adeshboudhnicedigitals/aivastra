import { describe, expect, it } from 'vitest';
import { numericLimitPatch, OFF, resolveNumericLimit } from './limits';

describe('resolveNumericLimit', () => {
  it('keeps 0, which is a real option and falsy', () => {
    expect(resolveNumericLimit('0', 2)).toBe(0);
  });

  it('parses an option value, and falls back only when it is not a number', () => {
    expect(resolveNumericLimit('5', 2)).toBe(5);
    expect(resolveNumericLimit('nope', 2)).toBe(2);
  });
});

describe('numericLimitPatch', () => {
  it('turns Off into null, so the API clears the limit', () => {
    expect(numericLimitPatch('perShopperCap', OFF, 5)).toEqual({ perShopperCap: null });
  });

  it('maps the email gate "Before the first try-on" to 0, not the preselected value', () => {
    expect(numericLimitPatch('emailAfterNTryOns', '0', 2)).toEqual({ emailAfterNTryOns: 0 });
  });
});

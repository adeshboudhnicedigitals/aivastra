import { describe, expect, it } from 'vitest';
import { normaliseCartCode, rupees } from './cart-format';

describe('cart-format', () => {
  it('formats paise as rupees with Indian grouping', () => {
    expect(rupees(4_990_000)).toBe('₹49,900');
    expect(rupees(12_345_600)).toBe('₹1,23,456');
  });
  it('accepts a typed code in any case with spaces, and refuses ambiguous letters', () => {
    expect(normaliseCartCode(' abcd 2345 ')).toBe('ABCD2345');
    expect(normaliseCartCode('ABCD234O')).toBeNull();
    expect(normaliseCartCode('ABC')).toBeNull();
  });
});

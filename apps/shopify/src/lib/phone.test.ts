import { describe, expect, it } from 'vitest';
import { isValidPhone } from './phone';

describe('isValidPhone (must match packages/types/src/phone.ts)', () => {
  const valid = ['9876543', '+91 98765-43210', '(555) 010-0123', ' 555.0100.123 '];
  const invalid = ['', '   ', '123456', '+()- .', 'call me', '98765x43210', '1'.repeat(31)];

  it.each(valid)('accepts %j', (v) => expect(isValidPhone(v)).toBe(true));
  it.each(invalid)('rejects %j', (v) => expect(isValidPhone(v)).toBe(false));
});

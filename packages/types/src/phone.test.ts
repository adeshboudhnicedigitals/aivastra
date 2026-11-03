import { describe, expect, it } from 'vitest';
import { isValidPhone, phoneDigitCount } from './phone.js';

describe('phoneDigitCount', () => {
  it('counts digits only', () => {
    expect(phoneDigitCount('+91 98765-43210')).toBe(12);
    expect(phoneDigitCount('()-.+ ')).toBe(0);
  });
});

describe('isValidPhone', () => {
  const valid = ['9876543', '+91 98765-43210', '(555) 010-0123', ' 555.0100.123 '];
  const invalid = [
    '',
    '   ',
    '123456', // 6 digits
    '+()- .', // allowed characters but no digits
    'call me',
    '98765x43210',
    `${'1'.repeat(31)}`, // over the length cap
  ];

  it.each(valid)('accepts %j', (v) => expect(isValidPhone(v)).toBe(true));
  it.each(invalid)('rejects %j', (v) => expect(isValidPhone(v)).toBe(false));
});

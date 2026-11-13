import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeAt,
  hashRecoveryCode,
  newRecoveryCodes,
  stepNow,
  verifyTotp,
} from '../src/modules/admin/totp.js';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (6-digit truncation of the vectors).
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(codeAt(SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(SECRET, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('round-trips base32', () => {
    const b = Buffer.from([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });

  it('accepts one step of drift either side, not two', () => {
    const now = 1_700_000_000_000;
    const cur = stepNow(now);
    expect(verifyTotp(SECRET, codeAt(SECRET, cur), null, now)).toBe(cur);
    expect(verifyTotp(SECRET, codeAt(SECRET, cur - 1), null, now)).toBe(cur - 1);
    expect(verifyTotp(SECRET, codeAt(SECRET, cur + 1), null, now)).toBe(cur + 1);
    expect(verifyTotp(SECRET, codeAt(SECRET, cur - 2), null, now)).toBeNull();
  });

  it('refuses a step at or before the last accepted one (replay)', () => {
    const now = 1_700_000_000_000;
    const cur = stepNow(now);
    expect(verifyTotp(SECRET, codeAt(SECRET, cur), cur, now)).toBeNull();
    expect(verifyTotp(SECRET, codeAt(SECRET, cur + 1), cur, now)).toBe(cur + 1);
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(SECRET, '12345', null)).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', null)).toBeNull();
  });

  it('makes distinct recovery codes and hashes them case/dash-insensitively', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    const c = codes[0] as string;
    expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toLowerCase().replace('-', ' ')));
  });
});

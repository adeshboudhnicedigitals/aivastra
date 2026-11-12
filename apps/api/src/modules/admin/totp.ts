import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s), compatible with Google Authenticator, Authy,
// 1Password and Microsoft Authenticator. No dependency: it is one HMAC and some arithmetic.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(email: string, secret: string): string {
  const issuer = 'AiVastra';
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (h[h.length - 1] as number) & 15;
  const bin =
    (((h[offset] as number) & 127) << 24) |
    (((h[offset + 1] as number) & 255) << 16) |
    (((h[offset + 2] as number) & 255) << 8) |
    ((h[offset + 3] as number) & 255);
  return String(bin % 1_000_000).padStart(6, '0');
}

export const stepNow = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Accepts the current step and one either side (clock drift). Returns the matched step, or null.
 * `lastStep` rejects any step at or before the last one accepted, so a code cannot be reused.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = stepNow(now);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(codeAt(secret, step));
    const got = Buffer.from(code);
    if (timingSafeEqual(want, got)) return step;
  }
  return null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = Array.from(randomBytes(10), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
      '',
    );
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');

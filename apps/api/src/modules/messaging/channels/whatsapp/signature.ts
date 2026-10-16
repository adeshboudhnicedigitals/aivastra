import { createHmac, timingSafeEqual } from 'node:crypto';

/** Meta signs the raw body: `X-Hub-Signature-256: sha256=<hex HMAC with the app secret>`. */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  // Constant-time, and length-checked first: timingSafeEqual throws on unequal lengths.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

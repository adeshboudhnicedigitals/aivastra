import { createHmac, hkdfSync } from 'node:crypto';
import { decryptToken, encryptToken } from '../../lib/crypto.js';

// CRM phase 2, plan decision C1: one provisioned secret (CRM_DATA_KEY, 32 bytes base64), three
// purpose-bound subkeys derived with HKDF. A subkey compromised for one purpose (say the lookup
// hash, which every phone lookup touches) does not open the others.

const SALT = Buffer.from('aivastra-crm-v1');

function subkey(masterB64: string | undefined, purpose: string): Buffer {
  if (!masterB64) throw new Error('CRM_DATA_KEY is not configured');
  const master = Buffer.from(masterB64, 'base64');
  if (master.length !== 32) throw new Error('CRM_DATA_KEY must be 32 bytes (base64)');
  return Buffer.from(hkdfSync('sha256', master, SALT, Buffer.from(purpose), 32));
}

const b64 = (k: Buffer) => k.toString('base64');

/** Merchant WhatsApp channel secrets (access token, app secret). */
export function sealSecret(master: string | undefined, plaintext: string): string {
  return encryptToken(plaintext, b64(subkey(master, 'channel-secret')));
}

export function openSecret(master: string | undefined, sealed: string): string {
  return decryptToken(sealed, b64(subkey(master, 'channel-secret')));
}

/** Normalises a WhatsApp wa_id / E.164 number to bare digits, the one form ever hashed. */
export function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function encryptPhone(master: string | undefined, phone: string): string {
  return encryptToken(normalisePhone(phone), b64(subkey(master, 'phone-enc')));
}

export function decryptPhone(master: string | undefined, enc: string): string {
  return decryptToken(enc, b64(subkey(master, 'phone-enc')));
}

/**
 * Keyed lookup hash: equal numbers hash equal, so (merchant_id, phone_hash) finds a returning
 * shopper without decrypting anything. HMAC, not a bare hash: India has ~10^10 numbers, and an
 * unkeyed sha256 of every one is an afternoon's work.
 */
export function phoneHash(master: string | undefined, phone: string): string {
  return createHmac('sha256', subkey(master, 'phone-hash'))
    .update(normalisePhone(phone))
    .digest('hex');
}

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptPhone,
  encryptPhone,
  normalisePhone,
  openSecret,
  phoneHash,
  sealSecret,
} from './crypto.js';

const key = randomBytes(32).toString('base64');
const other = randomBytes(32).toString('base64');

describe('crm crypto', () => {
  it('round-trips a channel secret, with a fresh ciphertext each time', () => {
    const a = sealSecret(key, 'EAAG-token');
    const b = sealSecret(key, 'EAAG-token');
    expect(a).not.toBe(b);
    expect(openSecret(key, a)).toBe('EAAG-token');
  });

  it('stores numbers as bare digits and decrypts them back', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('919876543210');
    expect(decryptPhone(key, encryptPhone(key, '+91 98765 43210'))).toBe('919876543210');
  });

  it('hashes the same number the same way whatever its formatting, and differently per key', () => {
    expect(phoneHash(key, '+919876543210')).toBe(phoneHash(key, '91 98765 43210'));
    expect(phoneHash(key, '919876543210')).not.toBe(phoneHash(key, '919876543211'));
    expect(phoneHash(key, '919876543210')).not.toBe(phoneHash(other, '919876543210'));
  });

  it('keeps purposes apart: a phone ciphertext does not open as a channel secret', () => {
    expect(() => openSecret(key, encryptPhone(key, '919876543210'))).toThrow();
  });

  it('refuses the wrong key, a missing key and a short key', () => {
    expect(() => openSecret(other, sealSecret(key, 'x'))).toThrow();
    expect(() => sealSecret(undefined, 'x')).toThrow(/not configured/);
    expect(() => sealSecret(randomBytes(16).toString('base64'), 'x')).toThrow(/32 bytes/);
  });
});

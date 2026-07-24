import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Blocks loopback, private, link-local, and other non-public ranges. Applied to
 * the actually-resolved IP (not just the hostname string) so a hostname that
 * resolves to a private address is still blocked.
 */
function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const a = parts[0];
    const b = parts[1];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (family === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true; // loopback
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local fc00::/7
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true; // link-local fe80::/10
    }
    if (normalized === '::' || normalized.startsWith('::ffff:127.')) return true;
    return false;
  }
  return true; // not a recognizable IP — treat as blocked
}

/**
 * Validates a user-supplied URL is safe for the server to fetch: http(s) only,
 * and every DNS-resolved address for its hostname is a public address. Returns
 * the parsed URL for the caller to actually fetch.
 */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AppError('VALIDATION', 400, 'not a valid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AppError('VALIDATION', 400, 'only http/https URLs are supported');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily !== 0
      ? [hostname]
      : (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  if (addresses.length === 0) {
    throw new AppError('VALIDATION', 400, 'could not resolve host');
  }
  if (addresses.some((ip) => isBlockedIp(ip))) {
    throw new AppError('VALIDATION', 400, 'this URL host is not allowed');
  }
  return parsed;
}

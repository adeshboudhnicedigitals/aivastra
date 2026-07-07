import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEq(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }
  return safeEq(digest, provided);
}

export function verifyQueryHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = createHmac('sha256', secret).update(msg).digest('hex');
  return safeEq(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
}

export function shopHostFromDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

interface SessionClaims {
  iss?: string;
  dest?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
}

export function verifySessionToken(
  token: string,
  secret: string,
  apiKey: string,
): { dest: string; shopDomain: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed session token');
  const [headB64, bodyB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headB64, 'base64url').toString()) as { alg?: string };
  if (header.alg !== 'HS256') throw new Error('unexpected token alg'); // never accept `none`
  const expected = createHmac('sha256', secret).update(`${headB64}.${bodyB64}`).digest('base64url');
  if (!safeEq(Buffer.from(expected), Buffer.from(sigB64))) throw new Error('bad signature');

  const claims = JSON.parse(Buffer.from(bodyB64, 'base64url').toString()) as SessionClaims;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new Error('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 5)
    throw new Error('token not yet valid');
  if (claims.aud !== apiKey) throw new Error('aud mismatch');
  if (!claims.dest || !claims.iss) throw new Error('missing dest/iss');
  if (shopHostFromDomain(claims.dest) !== shopHostFromDomain(claims.iss))
    throw new Error('iss/dest host mismatch');
  const shopDomain = shopHostFromDomain(claims.dest);
  return { dest: claims.dest, shopDomain };
}

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyQueryHmac,
  verifySessionToken,
  verifyWebhookHmac,
} from '../src/modules/shopify/service.js';

const SECRET = 'shpss_test_secret';
const API_KEY = 'shpapikey';

function signHs256(payloadObj: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payloadObj);
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

describe('shopify service', () => {
  it('verifies a valid webhook HMAC', () => {
    const raw = Buffer.from('{"id":1}');
    const hmac = createHmac('sha256', SECRET).update(raw).digest('base64');
    expect(verifyWebhookHmac(raw, hmac, SECRET)).toBe(true);
    expect(verifyWebhookHmac(raw, 'AAAA', SECRET)).toBe(false);
  });

  it('verifies a valid query HMAC and rejects tampering', () => {
    const params: Record<string, string> = { shop: 'a.myshopify.com', code: 'abc', ts: '1' };
    const msg = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const hmac = createHmac('sha256', SECRET).update(msg).digest('hex');
    expect(verifyQueryHmac({ ...params, hmac }, SECRET)).toBe(true);
    expect(verifyQueryHmac({ ...params, hmac, code: 'evil' }, SECRET)).toBe(false);
  });

  it('verifies a valid session token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signHs256({
      iss: 'https://a.myshopify.com/admin',
      dest: 'https://a.myshopify.com',
      aud: API_KEY,
      exp: now + 60,
      nbf: now - 5,
      iat: now,
    });
    const res = verifySessionToken(token, SECRET, API_KEY);
    expect(res.shopDomain).toBe('a.myshopify.com');
  });

  it('rejects a session token with wrong aud', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signHs256({
      iss: 'https://a.myshopify.com/admin',
      dest: 'https://a.myshopify.com',
      aud: 'other',
      exp: now + 60,
      nbf: now - 5,
    });
    expect(() => verifySessionToken(token, SECRET, API_KEY)).toThrow();
  });

  it('rejects an expired session token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signHs256({
      iss: 'https://a.myshopify.com/admin',
      dest: 'https://a.myshopify.com',
      aud: API_KEY,
      exp: now - 10,
      nbf: now - 60,
    });
    expect(() => verifySessionToken(token, SECRET, API_KEY)).toThrow();
  });
});

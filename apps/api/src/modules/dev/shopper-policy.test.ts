import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  buildShopperGate,
  deriveTokenSecret,
  type ShopperPolicy,
  signShopperToken,
  verifyShopperToken,
} from './shopper-policy.js';

const JWT_SECRET = 'x'.repeat(40);
const MERCHANT = '11111111-1111-1111-1111-111111111111';
const now = () => Math.floor(Date.now() / 1000);

/** Just enough Redis for the quota counters. */
function fakeApp(): FastifyInstance {
  const store = new Map<string, number>();
  const redis = {
    get: async (k: string) => (store.has(k) ? String(store.get(k)) : null),
    incr: async (k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return store.get(k) as number;
    },
    decr: async (k: string) => {
      store.set(k, (store.get(k) ?? 0) - 1);
      return store.get(k) as number;
    },
    expire: async () => 1,
  };
  return {
    env: { JWT_SECRET },
    redis,
    log: { warn: () => {} },
  } as unknown as FastifyInstance;
}

const secret = deriveTokenSecret(JWT_SECRET, MERCHANT, 1);
const token = (sid: string, lg: boolean, exp = now() + 600) =>
  signShopperToken(secret, { sid, lg, exp });

async function code(fn: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : 'OTHER';
  }
}

describe('shopper token', () => {
  it('round-trips claims', () => {
    const claims = verifyShopperToken(secret, token('u:7', true));
    expect(claims).toMatchObject({ sid: 'u:7', lg: true });
  });

  it('rejects a tampered payload, a wrong secret, an expired token and junk', () => {
    const good = token('u:7', false);
    const [payload, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ sid: 'u:7', lg: 1, exp: now() + 600 })).toString(
      'base64url',
    );
    expect(verifyShopperToken(secret, `${forged}.${sig}`)).toBeNull();
    expect(verifyShopperToken(deriveTokenSecret(JWT_SECRET, MERCHANT, 2), good)).toBeNull();
    expect(verifyShopperToken(secret, token('u:7', true, now() - 5))).toBeNull();
    expect(verifyShopperToken(secret, undefined)).toBeNull();
    expect(verifyShopperToken(secret, 'nodot')).toBeNull();
    expect(verifyShopperToken(secret, `${payload}.`)).toBeNull();
  });

  it('derives a different secret per merchant and per version', () => {
    expect(deriveTokenSecret(JWT_SECRET, MERCHANT, 1)).not.toBe(
      deriveTokenSecret(JWT_SECRET, '22222222-2222-2222-2222-222222222222', 1),
    );
    expect(deriveTokenSecret(JWT_SECRET, MERCHANT, 1)).not.toBe(
      deriveTokenSecret(JWT_SECRET, MERCHANT, 2),
    );
  });
});

describe('buildShopperGate', () => {
  const policy = (over: Partial<ShopperPolicy>): ShopperPolicy => ({
    loginRequired: false,
    perShopperCap: null,
    secretVersion: 1,
    ...over,
  });
  const gate = (app: FastifyInstance, p: ShopperPolicy | null, tok?: string, ip = '203.0.113.5') =>
    buildShopperGate(app, { merchantId: MERCHANT, policy: p, token: tok, ip });

  it('does not apply with no policy, or one that restricts nothing', async () => {
    const app = fakeApp();
    expect(gate(app, null)).toBeNull();
    expect(gate(app, policy({}))).toBeNull();
  });

  it('refuses a missing or invalid token once anything is restricted', async () => {
    const app = fakeApp();
    expect(await code(() => gate(app, policy({ perShopperCap: 3 }), undefined))).toBe(
      'SHOPPER_TOKEN_INVALID',
    );
    expect(await code(() => gate(app, policy({ loginRequired: true }), 'garbage'))).toBe(
      'SHOPPER_TOKEN_INVALID',
    );
  });

  it('requires a logged-in claim when login is required', async () => {
    const app = fakeApp();
    const p = policy({ loginRequired: true });
    expect(await code(() => gate(app, p, token('g:abc', false)))).toBe('LOGIN_REQUIRED');
    expect(await code(() => gate(app, p, token('u:7', true)))).toBeNull();
  });

  it('allows exactly the cap, then refuses, per shopper', async () => {
    const app = fakeApp();
    const p = policy({ perShopperCap: 2 });
    const tok = token('u:7', true);
    for (let i = 0; i < 2; i++) {
      const g = gate(app, p, tok);
      await g?.precheck();
      await g?.reserve();
    }
    const third = gate(app, p, tok);
    expect(await code(() => third?.precheck())).toBe('SHOPPER_LIMIT');
    expect(await code(() => third?.reserve())).toBe('SHOPPER_LIMIT');

    // A different logged-in shopper is unaffected.
    const other = gate(app, p, token('u:8', true));
    expect(await code(() => other?.reserve())).toBeNull();
  });

  it('a refused reserve does not leave the quota consumed', async () => {
    const app = fakeApp();
    const p = policy({ perShopperCap: 1 });
    const tok = token('u:7', true);
    await gate(app, p, tok)?.reserve();
    await code(() => gate(app, p, tok)?.reserve()); // refused, rolled back
    const g = gate(app, p, tok);
    await g?.release(); // job creation failed -> slot returned
    expect(await code(() => gate(app, p, tok)?.reserve())).toBeNull();
  });

  it('counts a guest by address too, so clearing the cookie does not reset it', async () => {
    const app = fakeApp();
    const p = policy({ perShopperCap: 1 });
    await gate(app, p, token('g:one', false), '198.51.100.9')?.reserve();
    const fresh = gate(app, p, token('g:two', false), '198.51.100.9');
    expect(await code(() => fresh?.reserve())).toBe('SHOPPER_LIMIT');
    // …but a logged-in shopper on the same address is not throttled with them.
    const member = gate(app, p, token('u:7', true), '198.51.100.9');
    expect(await code(() => member?.reserve())).toBeNull();
  });
});

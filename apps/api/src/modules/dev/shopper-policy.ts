import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';

/**
 * Shopper policy for WordPress storefronts: "require customer login" and
 * "N try-ons per shopper per 24 hours" (the same two controls the Shopify
 * app's onboarding limits step offers).
 *
 * Why a signed token: the WordPress widget calls POST /v1/dev/tryon straight
 * from the shopper's browser with the PUBLIC widget key, so the API has no
 * way to know who the shopper is. The plugin's server (which can tell who is
 * logged in) mints a short-lived token with an HMAC secret only it and the API
 * hold; the widget forwards it in X-Aivastra-Shopper. Anyone calling the API
 * directly without a valid token is refused whenever the merchant has a policy
 * that restricts anything.
 *
 * The signing secret is DERIVED (HMAC of JWT_SECRET over merchantId and
 * `secretVersion`), never stored, so a database dump does not yield the means
 * to forge tokens. Bumping `secretVersion` rotates it.
 */

export const SHOPPER_TOKEN_HEADER = 'x-aivastra-shopper';
export const SHOPPER_WINDOW_SECONDS = 24 * 60 * 60;

export interface ShopperPolicy {
  loginRequired: boolean;
  perShopperCap: number | null;
  secretVersion: number;
}

export interface ShopperClaims {
  /** "u:<wp user id>" for a logged-in shopper, "g:<random id>" for a guest. */
  sid: string;
  /** True only when the plugin saw an authenticated WordPress session. */
  lg: boolean;
  /** Expiry, unix seconds. */
  exp: number;
}

export function deriveTokenSecret(jwtSecret: string, merchantId: string, version: number): string {
  return createHmac('sha256', jwtSecret)
    .update(`wp-shopper-token:${merchantId}:${version}`)
    .digest('base64url');
}

function sign(secret: string, payloadB64: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Mirrors what the plugin does in PHP; used by tests and as the format reference. */
export function signShopperToken(secret: string, claims: ShopperClaims): string {
  const payload = Buffer.from(
    JSON.stringify({ sid: claims.sid, lg: claims.lg ? 1 : 0, exp: claims.exp }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyShopperToken(
  secret: string,
  token: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): ShopperClaims | null {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid?: unknown;
      lg?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.sid !== 'string' || parsed.sid.length === 0 || parsed.sid.length > 128) {
      return null;
    }
    if (typeof parsed.exp !== 'number' || parsed.exp < nowSeconds) return null;
    return { sid: parsed.sid, lg: parsed.lg === 1, exp: parsed.exp };
  } catch {
    return null;
  }
}

/** A policy that restricts nothing needs no token — don't make it a dependency. */
export function policyRestrictsAnything(policy: ShopperPolicy): boolean {
  return policy.loginRequired || policy.perShopperCap != null;
}

function quotaKeys(merchantId: string, claims: ShopperClaims, ip: string): string[] {
  const base = `dev:shopper-quota:${merchantId}`;
  const keys = [`${base}:${claims.sid}`];
  // A guest id lives in a cookie the shopper can clear, so a guest is also
  // counted by network address. A logged-in id is a WordPress account and
  // can't be reset that way, so it is counted alone (office/NAT networks
  // shouldn't throttle logged-in customers together).
  if (!claims.lg) {
    keys.push(`${base}:ip:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`);
  }
  return keys;
}

export interface ShopperGate {
  /** Cheap pre-check, run before the request body is read and uploaded. */
  precheck(): Promise<void>;
  /** Atomically takes one try-on from the quota; throws SHOPPER_LIMIT when spent. */
  reserve(): Promise<void>;
  /** Gives the reserved try-on back when job creation failed. */
  release(): Promise<void>;
}

/**
 * Returns null when the policy doesn't apply (no policy, or one that
 * restricts nothing). Otherwise validates the token and the login requirement
 * immediately — those throw from here — and hands back the quota controls.
 */
export function buildShopperGate(
  app: FastifyInstance,
  params: {
    merchantId: string;
    policy: ShopperPolicy | null;
    token: string | undefined;
    ip: string;
  },
): ShopperGate | null {
  const { merchantId, policy, token, ip } = params;
  if (!policy || !policyRestrictsAnything(policy)) return null;

  const secret = deriveTokenSecret(app.env.JWT_SECRET, merchantId, policy.secretVersion);
  const claims = verifyShopperToken(secret, token);
  if (!claims) {
    throw new AppError(
      'SHOPPER_TOKEN_INVALID',
      403,
      'Your session expired. Please reload the page and try again.',
    );
  }
  if (policy.loginRequired && !claims.lg) {
    throw new AppError(
      'LOGIN_REQUIRED',
      403,
      'Please log in to your account to use virtual try-on.',
    );
  }

  const cap = policy.perShopperCap;
  if (cap == null) {
    return { precheck: async () => {}, reserve: async () => {}, release: async () => {} };
  }

  const redis: Redis = app.redis;
  const keys = quotaKeys(merchantId, claims, ip);
  const limitError = () =>
    new AppError(
      'SHOPPER_LIMIT',
      429,
      `You've reached your limit of ${cap} try-on${cap === 1 ? '' : 's'} in 24 hours. Please come back later.`,
      { limit: cap },
    );

  return {
    async precheck() {
      try {
        for (const key of keys) {
          const used = Number((await redis.get(key)) ?? 0);
          if (used >= cap) throw limitError();
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        // Fail open on a Redis error, like the other limiters on this route.
        app.log.warn({ err, merchantId }, 'shopper quota precheck failed open on redis error');
      }
    },
    async reserve() {
      const taken: string[] = [];
      try {
        for (const key of keys) {
          const used = await redis.incr(key);
          taken.push(key);
          if (used === 1) await redis.expire(key, SHOPPER_WINDOW_SECONDS);
          if (used > cap) {
            await Promise.all(taken.map((k) => redis.decr(k)));
            throw limitError();
          }
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        app.log.warn({ err, merchantId }, 'shopper quota reserve failed open on redis error');
      }
    },
    async release() {
      try {
        await Promise.all(keys.map((k) => redis.decr(k)));
      } catch (err) {
        app.log.warn({ err, merchantId }, 'shopper quota release failed');
      }
    },
  };
}

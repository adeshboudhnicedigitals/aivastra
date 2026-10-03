import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  WordpressConnectBodyWithPhone,
  WordpressConnectExchangeBody,
  type WordpressConnectExchangeResponse,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { ensureMerchantForUser, mintWordpressKeyPair } from './wordpress-shared.js';

const REDIS_PREFIX = 'wordpress:connect:';
// Long enough to survive the aivastra.com consent-page redirect back to
// wp-admin (a same-browser, same-request round trip — no external IdP in the
// middle, unlike Google's 60s OTP which has to survive Google's own
// consent/2FA screens), short enough that a code left in a WP site's access
// log or browser history is worthless within minutes.
const CODE_TTL_SECONDS = 120;

/**
 * "Connect with Ai Vastra" account-link flow (docs/wordpress-plugin-design.md
 * §4.1). The WordPress plugin is the OAuth "client", app.aivastra.com is the
 * "authorization server" — reversed from how this codebase's existing OAuth
 * code (google.routes.ts) uses the pattern, but the same mechanics: a
 * short-lived, single-use Redis code hands a secret across a redirect
 * without ever putting it in a URL or browser history.
 */
export async function wordpressConnectRoutes(app: FastifyInstance) {
  // Gated on the caller's own session JWT (requireUser, not requireMerchant) —
  // a brand-new Google signup reaching this route has no merchants row yet,
  // and requireMerchant would 403 before the handler ever ran. The handler
  // itself now does that lookup (and self-serve creation, via
  // ensureMerchantForUser) so it can finish setup inline instead of
  // dead-ending on "contact support". Never mints keys for anyone but the
  // authenticated caller themselves — same invariant api-keys.routes.ts
  // documents: a leaked key must never be able to mint another one.
  app.post(
    '/v1/merchant/wordpress-connect',
    { preHandler: app.requireUser, schema: { body: WordpressConnectBodyWithPhone } },
    async (req) => {
      const { siteUrl, siteName, phone } = req.body as z.infer<
        typeof WordpressConnectBodyWithPhone
      >;

      const { fullKey, widgetKey, companyName, credits } = await app.db.transaction(async (tx) => {
        const { merchantId } = await ensureMerchantForUser(tx, req.userId, {
          companyName: siteName,
          phone,
        });

        const [row] = await tx
          .select({
            companyName: schema.merchants.companyName,
            credits: schema.userCredits.balance,
          })
          .from(schema.merchants)
          .leftJoin(schema.userCredits, eq(schema.userCredits.userId, schema.merchants.userId))
          .where(eq(schema.merchants.id, merchantId))
          .limit(1);
        if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');

        const { fullKey, widgetKey } = await mintWordpressKeyPair(
          tx,
          merchantId,
          siteUrl,
          siteName,
        );
        return { fullKey, widgetKey, companyName: row.companyName, credits: row.credits ?? 0 };
      });

      const payload: WordpressConnectExchangeResponse = {
        fullKey,
        widgetKey,
        companyName,
        credits,
      };
      const code = randomUUID();
      await app.redis.set(REDIS_PREFIX + code, JSON.stringify(payload), 'EX', CODE_TTL_SECONDS);
      return { code };
    },
  );

  // Public — called server-to-server by the WordPress plugin's callback
  // handler, not from a browser. Protected only by the one-time, short-lived,
  // unguessable code (same shape as /v1/auth/google/exchange's OTP
  // redemption); rate-limited as defense in depth against brute-forcing it.
  app.post(
    '/v1/wordpress/connect/exchange',
    {
      schema: { body: WordpressConnectExchangeBody },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { code } = req.body as z.infer<typeof WordpressConnectExchangeBody>;
      const raw = await app.redis.getdel(REDIS_PREFIX + code);
      if (!raw) throw new AppError('INVALID_CODE', 400, 'invalid or expired code');
      return JSON.parse(raw) as WordpressConnectExchangeResponse;
    },
  );
}

import {
  WordpressConnectBodyWithPhone,
  WordpressConnectExchangeBody,
  type WordpressConnectExchangeResponse,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  connectWordpressForUser,
  mintWordpressConnectCode,
  WORDPRESS_CONNECT_CODE_PREFIX,
} from './wordpress-shared.js';

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

      const payload: WordpressConnectExchangeResponse = await app.db.transaction((tx) =>
        connectWordpressForUser(tx, req.userId, { siteUrl, siteName, phone }),
      );
      const code = await mintWordpressConnectCode(app.redis, payload);
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
      const raw = await app.redis.getdel(WORDPRESS_CONNECT_CODE_PREFIX + code);
      if (!raw) throw new AppError('INVALID_CODE', 400, 'invalid or expired code');
      return JSON.parse(raw) as WordpressConnectExchangeResponse;
    },
  );
}

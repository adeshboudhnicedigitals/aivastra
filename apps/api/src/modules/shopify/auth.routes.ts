import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { encryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { resolveAccountLinkCode } from './customer-auth.js';
import { writeWidgetKeyMetafield } from './metafields.js';
import { SHOPIFY_API_VERSION, verifyQueryHmac } from './service.js';
import { type TokenGrant, toTokenGrant } from './token.js';

export interface ShopDetails {
  shopifyShopId: number;
  shopDomain: string;
  myshopifyDomain: string;
  primaryDomain?: string;
  name: string;
  shopOwner?: string;
  email: string;
  phone?: string;
  address?: string;
  ianaTimezone?: string;
}

export async function upsertShopifyStore(
  app: FastifyInstance,
  shop: ShopDetails,
  accessToken: string,
  scope: string,
  grant?: TokenGrant,
) {
  const encKey = app.env.SHOPIFY_TOKEN_ENC_KEY;
  if (!encKey) throw new AppError('CONFIG', 500, 'SHOPIFY_TOKEN_ENC_KEY missing');
  const enc = encryptToken(accessToken, encKey);
  // Absent grant means a caller that predates expiring tokens (tests, mostly).
  // Null out the refresh half rather than leaving a previous install's values
  // behind, where they would point at a rotated-away token.
  const refreshCols = {
    refreshToken: grant?.refreshToken ? encryptToken(grant.refreshToken, encKey) : null,
    tokenExpiresAt: grant?.expiresAt ?? null,
    refreshTokenExpiresAt: grant?.refreshTokenExpiresAt ?? null,
  };
  const origins = [
    `https://${shop.myshopifyDomain}`,
    ...(shop.primaryDomain ? [`https://${shop.primaryDomain}`] : []),
  ];

  return app.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopifyShopId, shop.shopifyShopId))
      .limit(1);

    if (existing) {
      const [store] = await tx
        .update(schema.shopifyStores)
        .set({
          accessToken: enc,
          ...refreshCols,
          scope,
          ianaTimezone: shop.ianaTimezone ?? null,
          allowedOrigins: origins,
          uninstalledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.shopifyStores.id, existing.id))
        .returning();
      return store;
    }

    const [store] = await tx
      .insert(schema.shopifyStores)
      .values({
        shopDomain: shop.shopDomain,
        shopifyShopId: shop.shopifyShopId,
        accessToken: enc,
        ...refreshCols,
        scope,
        ianaTimezone: shop.ianaTimezone ?? null,
        allowedOrigins: origins,
      })
      .returning();
    return store;
  });
}

/**
 * Where to send the merchant once OAuth completes.
 *
 * This must hand control back to Shopify rather than point at our own SPA. Only
 * Shopify can mint the `host` and `id_token` query params that App Bridge needs
 * to reach the parent admin frame, and it only supplies them when it opens the
 * app itself. Redirecting straight at the SPA leaves App Bridge with no parent
 * coordinates, and every call into it — `idToken()` included — then hangs
 * forever: no resolve, no reject, no console error, just a permanent loading
 * spinner for the merchant.
 */
export function buildPostInstallRedirect(shop: string, apiKey: string): string {
  const storeHandle = shop.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${storeHandle}/apps/${apiKey}`;
}

export async function shopifyAuthRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/auth', async (req, reply) => {
    const shop = (req.query as { shop?: string }).shop;
    if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
      throw new AppError('BAD_REQUEST', 400, 'invalid shop');
    }
    const state = randomUUID();
    await app.redis.set(`shopify:nonce:${state}`, shop, 'EX', 600);
    const scopes = app.env.SHOPIFY_SCOPES;
    const redirectUri = `${app.env.SHOPIFY_APP_URL}/v1/shopify/auth/callback`;
    const url =
      `https://${shop}/admin/oauth/authorize?client_id=${app.env.SHOPIFY_API_KEY}` +
      `&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    return reply.redirect(url);
  });

  app.get('/v1/shopify/auth/callback', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!verifyQueryHmac(q, app.env.SHOPIFY_API_SECRET ?? '')) {
      throw new AppError('FORBIDDEN', 403, 'bad hmac');
    }
    const savedShop = await app.redis.get(`shopify:nonce:${q.state}`);
    if (!savedShop || savedShop !== q.shop) throw new AppError('FORBIDDEN', 403, 'bad state');
    await app.redis.del(`shopify:nonce:${q.state}`);
    // q.shop is already pinned to the value /v1/shopify/auth validated and stored
    // under this nonce, but it is interpolated into Shopify API URLs and the
    // return-to-admin redirect below — assert the format here so that safety is
    // local rather than inferred through a Redis round-trip.
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(q.shop)) {
      throw new AppError('BAD_REQUEST', 400, 'invalid shop');
    }

    // Exchange code → token
    const tokenRes = await fetch(`https://${q.shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: app.env.SHOPIFY_API_KEY,
        client_secret: app.env.SHOPIFY_API_SECRET,
        code: q.code,
        expiring: 1, // Shopify rejects non-expiring offline tokens as of API 2026-07
      }),
    });
    if (!tokenRes.ok) throw new AppError('SHOPIFY', 502, 'token exchange failed');
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      scope: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
    };
    const { access_token, scope } = tokenBody;
    // `expiring: 1` above makes access_token die in ~1h; the refresh half is
    // the only way back without sending the merchant through OAuth again, so
    // it has to be captured here — this is the one place Shopify hands it over.
    const grant = toTokenGrant(tokenBody);

    // Fetch shop details
    const shopRes = await fetch(`https://${q.shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': access_token },
    });
    if (!shopRes.ok) throw new AppError('SHOPIFY', 502, 'shop fetch failed');
    const { shop: s } = (await shopRes.json()) as {
      shop: {
        id: number;
        myshopify_domain: string;
        domain?: string;
        name: string;
        shop_owner?: string;
        email: string;
        phone?: string;
        address1?: string;
        city?: string;
        country?: string;
        iana_timezone?: string;
      };
    };
    const details: ShopDetails = {
      shopifyShopId: s.id,
      shopDomain: s.myshopify_domain,
      myshopifyDomain: s.myshopify_domain,
      primaryDomain: s.domain,
      name: s.name,
      shopOwner: s.shop_owner,
      email: s.email,
      phone: s.phone,
      address: [s.address1, s.city, s.country].filter(Boolean).join(', '),
      ianaTimezone: s.iana_timezone,
    };

    const store = await upsertShopifyStore(app, details, access_token, scope, grant);
    await writeWidgetKeyMetafield(q.shop, access_token, store.storeKey, req.log);
    // Webhook registration is Task 7; call registerWebhooks(app, q.shop, access_token) here once it exists.
    await app.shopifyRegisterWebhooks?.(q.shop, access_token);

    req.log.info({ storeId: store.id, shop: q.shop }, 'shopify store installed');
    // Not `?? ''`: a missing key would build a silently malformed redirect, which
    // is the exact failure mode this redirect exists to avoid.
    if (!app.env.SHOPIFY_API_KEY) throw new AppError('CONFIG', 500, 'SHOPIFY_API_KEY missing');
    return reply.redirect(buildPostInstallRedirect(q.shop, app.env.SHOPIFY_API_KEY));
  });

  app.post(
    '/v1/shopify/store/account/link',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const { code } = req.body as { code?: string };
      if (!code) throw new AppError('VALIDATION', 400, 'code is required');
      const userId = await resolveAccountLinkCode(app.redis, code);
      if (!userId) throw new AppError('UNAUTHORIZED', 401, 'Link code invalid or expired');
      const store = req.shopifyStore;
      if (!store) throw new AppError('FORBIDDEN', 403, 'Store not installed');
      await app.db
        .update(schema.shopifyStores)
        .set({ ownerUserId: userId, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));
      return { ok: true };
    },
  );

  app.post(
    '/v1/shopify/store/account/unlink',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore;
      if (!store) throw new AppError('FORBIDDEN', 403, 'Store not installed');
      await app.db
        .update(schema.shopifyStores)
        .set({ ownerUserId: null, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));
      return { ok: true };
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    shopifyRegisterWebhooks?: (shop: string, accessToken: string) => Promise<void>;
  }
}

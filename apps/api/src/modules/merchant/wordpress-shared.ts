import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import type { DbOrTx } from '../auth/campaign.js';
import { generateApiKey } from '../dev/keys.js';

/** Shared with wordpress-connect.routes.ts's /v1/wordpress/connect/exchange
 * and google.routes.ts's WordPress-skip-path in /v1/auth/google/callback —
 * both mint a code under this same prefix/TTL so handle_connect_callback()'s
 * exchange_connect_code() (wordpress-plugin/includes/class-connection-service.php)
 * needs no changes to tell them apart. */
export const WORDPRESS_CONNECT_CODE_PREFIX = 'wordpress:connect:';
// Long enough to survive the aivastra.com consent-page redirect back to
// wp-admin (a same-browser, same-request round trip — no external IdP in the
// middle, unlike Google's 60s OTP which has to survive Google's own
// consent/2FA screens), short enough that a code left in a WP site's access
// log or browser history is worthless within minutes.
export const WORDPRESS_CONNECT_CODE_TTL_SECONDS = 120;

export interface WordpressConnectPayload {
  fullKey: string;
  widgetKey: string;
  companyName: string;
  credits: number;
}

/** Stores the one-time code both WordPress-connect paths hand back to the
 * browser instead of the minted keys themselves. */
export async function mintWordpressConnectCode(
  redis: Redis,
  payload: WordpressConnectPayload,
): Promise<string> {
  const code = randomUUID();
  await redis.set(
    WORDPRESS_CONNECT_CODE_PREFIX + code,
    JSON.stringify(payload),
    'EX',
    WORDPRESS_CONNECT_CODE_TTL_SECONDS,
  );
  return code;
}

/** The full "resolve-or-create this user's merchant row, then mint a
 * site-scoped key pair" transaction both WordPress-connect paths need —
 * wordpress-connect.routes.ts's browser-mediated flow and google.routes.ts's
 * no-consent-page skip-path call this with the same shape so a future change
 * to either (e.g. what companyName/credits a caller sees) can't drift between
 * them. Throws whatever ensureMerchantForUser throws (notably FORBIDDEN when
 * an existing merchant has been deactivated) — callers decide how to surface
 * that themselves. */
export async function connectWordpressForUser(
  tx: DbOrTx,
  userId: string,
  opts: { siteUrl: string; siteName?: string; phone?: string },
): Promise<WordpressConnectPayload> {
  const { merchantId } = await ensureMerchantForUser(tx, userId, {
    companyName: opts.siteName,
    phone: opts.phone,
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
    opts.siteUrl,
    opts.siteName,
  );

  return { fullKey, widgetKey, companyName: row.companyName, credits: row.credits ?? 0 };
}

/** Same open-redirect guard apps/catalogues-web's own /connect/wordpress page
 * applies client-side (isTrustedCallback() in that page's own source) before
 * ever sending the browser back to a WordPress site — re-checked here because
 * google.routes.ts's skip-path (see /v1/auth/google/callback) redirects
 * straight to $redirectUri itself with no confirmation page in between, so
 * nothing else stands between attacker-controlled query params and a
 * reply.redirect() call. */
export function isTrustedWordpressCallback(redirectUri: string, siteUrl: string): boolean {
  try {
    const cb = new URL(redirectUri);
    const site = new URL(siteUrl);
    if (cb.protocol !== 'http:' && cb.protocol !== 'https:') return false;
    if (cb.origin !== site.origin) return false;
    return cb.pathname.endsWith('/wp-admin/admin-post.php');
  } catch {
    return false;
  }
}

/**
 * Mints the full+widget key pair a WordPress site needs, scoped to its origin
 * — same shape both WordPress connect paths rely on
 * (wordpress-connect.routes.ts's browser-redirect flow and
 * wordpress-login.routes.ts's embedded no-redirect flow), factored out so the
 * two never drift.
 */
export async function mintWordpressKeyPair(
  tx: DbOrTx,
  merchantId: string,
  siteUrl: string,
  siteName?: string,
): Promise<{ fullKey: string; widgetKey: string }> {
  const allowedOrigin = new URL(siteUrl).origin;
  const label = siteName ? `WordPress — ${siteName}` : `WordPress — ${allowedOrigin}`;
  const full = generateApiKey();
  const widget = generateApiKey();

  await tx.insert(schema.apiKeys).values([
    {
      merchantId,
      label,
      keyHash: full.keyHash,
      keyPrefix: full.keyPrefix,
      scope: 'full',
      integration: 'wordpress',
      allowedOrigin: null,
    },
    {
      merchantId,
      label,
      keyHash: widget.keyHash,
      keyPrefix: widget.keyPrefix,
      scope: 'widget',
      integration: 'wordpress',
      allowedOrigin,
    },
  ]);

  return { fullKey: full.key, widgetKey: widget.key };
}

/**
 * Finds the caller's merchant row, or creates one if this is their first
 * WordPress connection — same insert shape as the Android app's self-serve
 * onboarding (merchant/onboarding.routes.ts), signupSource 'wordpress'
 * instead of 'android_google'. `phone` is optional on this path (the embedded
 * connect form never blocks on it) — `merchants.phone` is NOT NULL
 * (packages/db/src/schema/merchant.ts) so a missing value falls back to the
 * same 'Not Provided' placeholder businessAddress already uses below, rather
 * than rejecting the connection. Everything else (companyName, contactName)
 * degrades to a reasonable default too, so the caller never has to supply
 * more than an email+password to connect.
 *
 * Throws AppError('FORBIDDEN', 403, ...) when a merchant row exists but is
 * deactivated — same message requireMerchant uses, so callers see identical
 * copy regardless of entry path.
 */
export async function ensureMerchantForUser(
  tx: DbOrTx,
  userId: string,
  opts: { companyName?: string; contactName?: string; phone?: string },
): Promise<{ merchantId: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
    .from(schema.merchants)
    .where(eq(schema.merchants.userId, userId))
    .limit(1);
  if (existing) {
    if (!existing.isActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');
    return { merchantId: existing.id, created: false };
  }

  const [user] = await tx
    .select({ displayName: schema.users.displayName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new AppError('UNAUTH', 401, 'user not found');

  const contactName =
    opts.contactName?.trim() || user.displayName?.trim() || user.email?.split('@')[0] || 'Merchant';

  const [created] = await tx
    .insert(schema.merchants)
    .values({
      companyName: opts.companyName?.trim() || contactName,
      contactName,
      phone: opts.phone?.trim() || 'Not Provided',
      businessAddress: 'Not Provided',
      isActive: true,
      demoData: false,
      signupSource: 'wordpress',
      userId,
    })
    .returning({ id: schema.merchants.id });
  if (!created) throw new AppError('INTERNAL', 500, 'failed to create merchant');

  return { merchantId: created.id, created: true };
}

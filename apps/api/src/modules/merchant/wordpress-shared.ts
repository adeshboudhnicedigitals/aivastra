import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DbOrTx } from '../auth/campaign.js';
import { generateApiKey } from '../dev/keys.js';

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

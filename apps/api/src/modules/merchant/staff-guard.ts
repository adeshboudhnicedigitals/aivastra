import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DbOrTx } from '../auth/campaign.js';

/**
 * Refuses when the user already has a merchant_staff row (active or not — an
 * inactive one still holds history/a seat). Without this a staff login could also
 * become a merchant owner, and member resolution would then pick one role silently.
 * Shared by every merchant-creation path so the message stays identical.
 */
export async function assertUserIsNotStaff(db: DbOrTx, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.merchantStaff.id })
    .from(schema.merchantStaff)
    .where(eq(schema.merchantStaff.userId, userId))
    .limit(1);
  if (row) {
    throw new AppError(
      'USER_IS_STAFF',
      409,
      'this account is a staff member of a merchant; remove it from staff before creating a merchant',
    );
  }
}

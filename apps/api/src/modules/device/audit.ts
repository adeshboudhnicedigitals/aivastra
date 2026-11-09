import { type DbTransaction, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

// audit_logs.actor_user_id is NOT NULL → users, and a device has no user. Device
// actions are attributed to the owning merchant's user with a distinct role so
// Team Activity can tell them apart from the merchant admin acting in Merchant Web.
export async function deviceAuditActor(tx: DbTransaction, merchantId: string) {
  const [row] = await tx
    .select({ userId: schema.merchants.userId })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');
  return { userId: row.userId, role: 'DEVICE' as const };
}

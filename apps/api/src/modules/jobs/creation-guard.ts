import { type DbTransaction, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

/** Serializes job insertion with account erasure's ban-and-scan boundary. */
export async function lockAndAssertUserCanCreateJobs(tx: DbTransaction, userId: string) {
  const [user] = await tx
    .select({ id: schema.users.id, isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for('update');
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');
}

import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/service.js';

/** A merchant IS a user with a widget_clients profile attached (same pattern as
 * admin_users). Reuses an existing `users` row by email if one exists, otherwise
 * creates one. Never overwrites an existing user's password. */
export async function findOrCreateUserForMerchant(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies by call site
  tx: any,
  params: { email: string; password: string; displayName: string; phone: string },
): Promise<{ user: typeof schema.users.$inferSelect; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, params.email))
    .limit(1);
  if (existing) return { user: existing, created: false };

  const passwordHash = await hashPassword(params.password);
  const [created] = await tx
    .insert(schema.users)
    .values({
      email: params.email,
      passwordHash,
      displayName: params.displayName,
      phone: params.phone,
    })
    .returning();
  return { user: created, created: true };
}

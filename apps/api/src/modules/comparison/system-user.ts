import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, eq, sql } from 'drizzle-orm';

// Public registration picks a random UUID. Reserving both ID and email lets us
// distinguish this insert-only identity from an unrelated email collision.
export const COMPARISON_SYSTEM_USER_ID = '91d7643b-cc02-4eca-8a36-e8a61c202c9a';
const SYSTEM_USER_ID = COMPARISON_SYSTEM_USER_ID;
const SYSTEM_USER_EMAIL = 'comparison-system@aivastra.internal';

export async function ensureComparisonSystemUser(
  db: Pick<DB, 'insert' | 'select'>,
): Promise<string> {
  await db
    .insert(schema.users)
    .values({
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      displayName: 'Workflow comparison system',
      passwordHash: null,
      isBanned: false,
      isOrganizationMember: true,
    })
    .onConflictDoNothing();
  const [user] = await db
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      emailVerified: schema.users.emailVerified,
      isBanned: schema.users.isBanned,
      isOrganizationMember: schema.users.isOrganizationMember,
      username: schema.users.username,
      hasAssociations: sql<boolean>`
      exists(select 1 from ${schema.refreshTokens} where ${schema.refreshTokens.userId} = ${SYSTEM_USER_ID})
      or exists(select 1 from ${schema.oauthAccounts} where ${schema.oauthAccounts.userId} = ${SYSTEM_USER_ID})
      or exists(select 1 from ${schema.merchants} where ${schema.merchants.userId} = ${SYSTEM_USER_ID})
      or exists(select 1 from ${schema.adminUsers} where ${schema.adminUsers.userId} = ${SYSTEM_USER_ID})
      or exists(select 1 from ${schema.userCredits} where ${schema.userCredits.userId} = ${SYSTEM_USER_ID})`,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, SYSTEM_USER_ID), eq(schema.users.email, SYSTEM_USER_EMAIL)));
  // Never repair/adopt an existing identity: changing a password or ban flag
  // cannot revoke prior sessions. Leave collisions untouched for investigation.
  if (
    !user ||
    user.passwordHash !== null ||
    user.emailVerified ||
    user.isBanned ||
    !user.isOrganizationMember ||
    user.username !== null ||
    user.hasAssociations
  ) {
    throw new Error('COMPARISON_SYSTEM_IDENTITY_CONFLICT');
  }
  return user.id;
}

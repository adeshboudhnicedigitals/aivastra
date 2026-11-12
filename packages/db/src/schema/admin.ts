import { bigint, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('SUPPORT'), // SUPER_ADMIN | MODERATOR | SUPPORT | ADMIN
  status: text('status').notNull().default('active'), // pending | active | rejected
  passwordHash: text('password_hash'), // copied from users.passwordHash at approval time
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // TOTP second factor. The secret is AES-256-GCM sealed under ADMIN_MFA_KEY; a row with a
  // totp_enabled_at is always challenged at login, whether or not enforcement is on.
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  // Last accepted 30-second step, so one code cannot be replayed inside its window.
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  // sha256 hex of each unused recovery code; a code is removed when used.
  totpRecoveryHashes: jsonb('totp_recovery_hashes').$type<string[]>().notNull().default([]),
  preferences: jsonb('preferences').$type<{ theme?: 'light' | 'dark' | 'system' }>().default({}),
});

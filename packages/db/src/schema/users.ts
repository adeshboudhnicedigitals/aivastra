import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { kioskDevices } from './kiosk.js';
import { merchants } from './merchant.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'), // nullable — Google-only users have no password
  displayName: text('display_name'),
  phone: text('phone'), // nullable — user-provided, no format enforcement
  companyName: text('company_name'),
  // FK to credit_plans.slug added in migration 0080 (ON DELETE RESTRICT) — not
  // declared via .references() here to avoid a circular import with credits.ts.
  tier: text('tier').notNull().default('free'),
  emailVerified: boolean('email_verified').notNull().default(false),
  isBanned: boolean('is_banned').notNull().default(false),
  maxActiveDevices: integer('max_active_devices').notNull().default(1),
  banReason: text('ban_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, {
      onDelete: 'cascade',
    }),
    merchantId: uuid('merchant_id').references(() => merchants.id, {
      onDelete: 'cascade',
    }),
    familyId: uuid('family_id').notNull(),
    generation: integer('generation').notNull().default(1),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked: boolean('revoked').notNull().default(false),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    portal: text('portal').notNull().default('web'), // 'web' | 'admin' | 'mobile' | 'kiosk'
    deviceId: text('device_id'),
    deviceName: text('device_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      'refresh_tokens_exactly_one_owner',
      sql`num_nonnulls(user_id, kiosk_device_id, merchant_id) = 1`,
    ),
  ],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('oauth_accounts_provider_provider_id_unique').on(t.provider, t.providerId)],
);

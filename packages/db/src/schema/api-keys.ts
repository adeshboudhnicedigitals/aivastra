import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { merchants } from './merchant.js';

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  // sha256(full key), hex. Unique so auth is a single index probe — and so a DB
  // dump never yields a usable key. The plaintext key exists only in the create
  // response.
  keyHash: text('key_hash').notNull().unique(),
  // e.g. "sk_live_a1b2" — dashboard display only, never sufficient to authenticate.
  keyPrefix: text('key_prefix').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

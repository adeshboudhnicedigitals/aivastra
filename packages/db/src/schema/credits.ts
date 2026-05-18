import { pgTable, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userCredits = pgTable('user_credits', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  jobId: uuid('job_id'),
  adminId: uuid('admin_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

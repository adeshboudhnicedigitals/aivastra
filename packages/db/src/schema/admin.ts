import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('SUPPORT'), // SUPER_ADMIN | MODERATOR | SUPPORT
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

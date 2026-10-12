import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';
import { users } from './users.js';

// One row per job — the unique job_id is what makes "a rejected request cannot be
// re-filed" a database guarantee rather than an application convention.
// credits is a snapshot of jobs.credits_charged at request time: it is what an
// approval refunds, even if the job row were ever to change afterwards.
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credits: integer('credits').notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    // 'PENDING' | 'APPROVED' | 'REJECTED'
    status: text('status').notNull().default('PENDING'),
    adminNote: text('admin_note'),
    // The admin's users.id (not admin_users.id), matching credit_ledger.admin_id.
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // True only when the auto-approve path approved this row — what the daily cap counts and the admin "Auto" badge reads. reviewed_by stays NULL for auto rows (no admin involved).
    autoApproved: boolean('auto_approved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusCreated: index('refund_requests_status_created_idx').on(t.status, t.createdAt),
    byUserReviewed: index('refund_requests_user_reviewed_idx').on(t.userId, t.reviewedAt),
  }),
);

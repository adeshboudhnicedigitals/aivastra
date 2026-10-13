import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// One row per (channel, sender): "this WhatsApp number belongs to that user".
// The bot never creates users (spec D13) — a row only ever attaches a number to
// an existing web account, so users itself needs no new kind of row. Generic
// channel/external_id so Messenger (PSID) and Instagram (IGSID) fit later
// without a second table. Single-use connect tokens are NOT stored here: they
// live in Redis with a TTL (modules/messaging/identity.ts).
export const messagingAccounts = pgTable(
  'messaging_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 'whatsapp' (later 'messenger' | 'instagram')
    channel: text('channel').notNull(),
    // E.164 for WhatsApp ('+919109516207'). Verified by construction: WhatsApp
    // delivered a message from it, unlike the unverified users.phone.
    externalId: text('external_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // When the seller confirmed the connect page (or sent the CONNECT code) — the
    // consent timestamp for the wording in spec section 14.
    optedInAt: timestamp('opted_in_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by STOP; the bot sends nothing while it is set. The connection stays.
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    // Last inbound message; the 24-hour window check before any free-form send.
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    // 'chat_link' | 'web_code'
    linkedVia: text('linked_via').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messaging_accounts_channel_external_id_uniq').on(t.channel, t.externalId),
    index('messaging_accounts_user_id_idx').on(t.userId),
  ],
);

// One row per create call made from a chat (D34). A run is one catalogueId:
// every job createJob makes in one call shares it. Plan 3's delivery finds a
// finished job's chat through this table, never through job_inputs.params —
// the create request strips unknown params keys, and params feeds the workflow.
// job_ids is an array, not a join table: a run is written once and read whole.
export const messagingRuns = pgTable(
  'messaging_runs',
  {
    catalogueId: uuid('catalogue_id').primaryKey(),
    messagingAccountId: uuid('messaging_account_id')
      .notNull()
      .references(() => messagingAccounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobIds: uuid('job_ids').array().notNull(),
    // Jobs whose outcome reached the chat (image sent, or failure accounted for).
    deliveredJobIds: uuid('delivered_job_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // D26: the paid "images are ready" template goes out at most once per run.
    readyNoticeSentAt: timestamp('ready_notice_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by plan 3 once the follow-up buttons for the whole run were sent.
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('messaging_runs_account_created_idx').on(t.messagingAccountId, t.createdAt)],
);

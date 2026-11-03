import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workers } from './workers.js';

// Fleet operations: planned maintenance windows and owner reservations. Both are operator-entered
// and audited. A maintenance window silences the alert evaluator for its worker while it is open;
// a reservation is a note ("w3 is lent to X until Friday") and changes no routing. Neither touches
// the dispatcher: draining and the job reservation token stay the dispatcher's own state.

export const fleetMaintenanceWindows = pgTable(
  'fleet_maintenance_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workerId: text('worker_id')
      .notNull()
      .references(() => workers.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    owner: text('owner').notNull(),
    reason: text('reason').notNull(),
    // SCHEDULED rows are live until they end; CANCELLED rows are kept as history.
    state: text('state').notNull().default('SCHEDULED'),
    createdBy: uuid('created_by').references(() => users.id),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('fleet_maintenance_windows_worker_idx').on(t.workerId, t.endsAt)],
);

/** At most one reservation note per worker; releasing it deletes the row (the audit log keeps it). */
export const fleetReservations = pgTable('fleet_reservations', {
  workerId: text('worker_id')
    .primaryKey()
    .references(() => workers.id),
  owner: text('owner').notNull(),
  reason: text('reason').notNull(),
  until: timestamp('until', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

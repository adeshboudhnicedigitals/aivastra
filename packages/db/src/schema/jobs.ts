import { pgTable, uuid, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { catalogItems } from './catalog';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('QUEUED'),
  workerId: text('worker_id'),
  priority: boolean('priority').notNull().default(false),
  creditsCharged: integer('credits_charged').notNull().default(1),
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const jobInputs = pgTable('job_inputs', {
  jobId: uuid('job_id').primaryKey().references(() => jobs.id, { onDelete: 'cascade' }),
  upperGarmentKey: text('upper_garment_key').notNull(),
  modelCatalogId: uuid('model_catalog_id').notNull().references(() => catalogItems.id),
  poseCatalogId: uuid('pose_catalog_id').notNull().references(() => catalogItems.id),
  backgroundCatalogId: uuid('background_catalog_id').notNull().references(() => catalogItems.id),
  lowerCatalogId: uuid('lower_catalog_id').notNull().references(() => catalogItems.id),
  userHint: text('user_hint'),
  params: jsonb('params'),
});

export const jobOutputs = pgTable('job_outputs', {
  jobId: uuid('job_id').primaryKey().references(() => jobs.id, { onDelete: 'cascade' }),
  resultKey: text('result_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobEvents = pgTable('job_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

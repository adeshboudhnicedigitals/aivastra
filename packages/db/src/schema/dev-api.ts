import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workflowTemplates } from './models.js';

// Dedicated developer-API try-on categories. Deliberately NOT tryon_categories:
// the public /v1/dev/* surface must be controllable independent of the internal
// Studio/kiosk/merchant catalog, so an admin renaming or deactivating an internal
// category never silently changes what third-party API callers can request.
export const devTryonCategories = pgTable('dev_tryon_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  workflowTemplateId: uuid('workflow_template_id').references(() => workflowTemplates.id, {
    onDelete: 'set null',
  }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Where the always-resident garment-recognition service lives (aivastra-gpu
 * pipeline/classify-service). A single row, id 'default': saved from the admin
 * Classify Service page, read by the dispatcher (to send requests) and the api
 * (to show status/logs). The env vars CLASSIFY_SERVICE_URL / _API_KEY are only
 * the fallback when no row exists. The key is stored as-is, like `workers.api_key`.
 */
export const classifyServiceConfig = pgTable('classify_service_config', {
  id: text('id').primaryKey().default('default'),
  url: text('url').notNull(),
  apiKey: text('api_key').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

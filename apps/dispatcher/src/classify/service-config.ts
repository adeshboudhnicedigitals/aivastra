import { type DB, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { ClassifyService } from './process.js';

/**
 * Where the recognition service is: the row saved from admin (Classify Service
 * page) first, the env vars as fallback, otherwise undefined (ComfyUI path).
 * Cached briefly so a save takes effect within seconds without a restart, and
 * a database blip keeps using the last known value instead of flipping the
 * lane to a worker that may not be there.
 */
export function createServiceResolver(
  db: DB,
  env: { CLASSIFY_SERVICE_URL?: string; CLASSIFY_SERVICE_API_KEY?: string },
  ttlMs = 10_000,
): () => Promise<ClassifyService | undefined> {
  let cached: { at: number; value: ClassifyService | undefined } | null = null;
  const fallback = (): ClassifyService | undefined =>
    env.CLASSIFY_SERVICE_URL && env.CLASSIFY_SERVICE_API_KEY
      ? { url: env.CLASSIFY_SERVICE_URL, apiKey: env.CLASSIFY_SERVICE_API_KEY }
      : undefined;

  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    try {
      const t = schema.classifyServiceConfig;
      const [row] = await db.select().from(t).where(eq(t.id, 'default'));
      const value = row ? { url: row.url, apiKey: row.apiKey } : fallback();
      cached = { at: Date.now(), value };
      return value;
    } catch {
      return cached ? cached.value : fallback();
    }
  };
}

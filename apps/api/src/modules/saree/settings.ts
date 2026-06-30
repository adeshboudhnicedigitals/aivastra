import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export interface SareeSettingsRow {
  modelImageKey: string | null;
  modelImageThumbKey: string | null;
}

export async function getSareeSettings(db: DB): Promise<SareeSettingsRow | null> {
  const [row] = await db
    .select({
      modelImageKey: schema.sareeSettings.modelImageKey,
      modelImageThumbKey: schema.sareeSettings.modelImageThumbKey,
    })
    .from(schema.sareeSettings)
    .where(eq(schema.sareeSettings.id, SETTINGS_ID));
  return row ?? null;
}

export async function upsertSareeSettings(
  db: DB,
  patch: { modelImageKey?: string | null; modelImageThumbKey?: string | null },
): Promise<void> {
  await db
    .insert(schema.sareeSettings)
    .values({ id: SETTINGS_ID, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.sareeSettings.id,
      set: { ...patch, updatedAt: new Date() },
    });
}

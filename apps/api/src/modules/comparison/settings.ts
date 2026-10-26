import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

export type ComparisonSettings = {
  enabled: boolean;
  backlogCap: number;
  retentionDays: number;
  enabledSince: string | null;
};

export const DEFAULT_COMPARISON_SETTINGS: ComparisonSettings = {
  enabled: false,
  backlogCap: 200,
  retentionDays: 30,
  enabledSince: null,
};

export const ComparisonSettingsPatch = z.object({
  enabled: z.boolean().optional(),
  backlogCap: z.number().int().min(1).max(5000).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

const StoredSettings = ComparisonSettingsPatch.extend({
  enabledSince: z.string().datetime().nullable().optional(),
});
const KEY = 'config:workflow-comparison';
const LOCK_KEY = `${KEY}:lock`;

export async function getComparisonSettings(app: FastifyInstance): Promise<ComparisonSettings> {
  const raw = await app.redis.get(KEY);
  if (raw === null) return { ...DEFAULT_COMPARISON_SETTINGS };
  try {
    const parsed = StoredSettings.parse(JSON.parse(raw));
    const settings = { ...DEFAULT_COMPARISON_SETTINGS, ...parsed };
    // A collection window is required before enabling; never coerce stored
    // strings/numbers to true or let malformed persisted config open the gate.
    if (settings.enabled === true && settings.enabledSince === null) {
      throw new Error('enabled comparison settings have no collection window');
    }
    return settings;
  } catch (err) {
    app.log.warn({ err }, 'invalid workflow comparison settings; comparison disabled');
    return { ...DEFAULT_COMPARISON_SETTINGS };
  }
}

export async function saveComparisonSettings(
  app: FastifyInstance,
  patch: Partial<Pick<ComparisonSettings, 'enabled' | 'backlogCap' | 'retentionDays'>>,
  beforeSave?: (before: ComparisonSettings, after: ComparisonSettings) => Promise<void>,
): Promise<ComparisonSettings> {
  const validatedPatch = ComparisonSettingsPatch.parse(patch);
  const token = randomUUID();
  const deadline = Date.now() + 5_000;
  // Serialize across API processes, including the audit-before-Redis window.
  // A lease makes crashes recoverable; the final Lua check fences expired owners.
  while ((await app.redis.set(LOCK_KEY, token, 'PX', 30_000, 'NX')) !== 'OK') {
    if (Date.now() >= deadline) {
      throw new AppError('COMPARISON_SETTINGS_BUSY', 503, 'Comparison settings are being updated');
    }
    await delay(25);
  }
  try {
    const before = await getComparisonSettings(app);
    const after = { ...before, ...validatedPatch };
    if (before.enabled !== true && after.enabled === true) {
      after.enabledSince = new Date().toISOString();
    }
    if (beforeSave) await beforeSave(before, after);
    const saved = await app.redis.eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       redis.call('SET', KEYS[2], ARGV[2])
       return 1`,
      2,
      LOCK_KEY,
      KEY,
      token,
      JSON.stringify(after),
    );
    if (saved !== 1) {
      throw new AppError(
        'COMPARISON_SETTINGS_BUSY',
        503,
        'Comparison settings update lease expired',
      );
    }
    return after;
  } finally {
    await app.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
       return 0`,
      1,
      LOCK_KEY,
      token,
    );
  }
}

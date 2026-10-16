import { schema } from '@aivastra/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

// Admin "Classify Service" page: health + logs of the always-resident
// recognition VLM (aivastra-gpu pipeline/classify-service) and request stats
// from garment_recognitions. The service is read here, never written; the
// dispatcher is what sends it recognition requests. Same permission as the
// recognitions list.

const PROBE_TIMEOUT_MS = 5_000;

const ConfigBody = z.object({
  url: z.string().url(),
  // Omitted = keep the stored key (the form never receives it back).
  apiKey: z.string().min(1).optional(),
});

const StatsQuery = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) });
const LogsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) });

export async function adminClassifyServiceRoutes(app: FastifyInstance) {
  const R = requirePermission('jobs.read');

  /** The saved row wins; the env vars are the fallback (first deploys, local dev). */
  async function effectiveConfig() {
    const [row] = await app.db
      .select()
      .from(schema.classifyServiceConfig)
      .where(eq(schema.classifyServiceConfig.id, 'default'));
    if (row) {
      return {
        source: 'db' as const,
        url: row.url.replace(/\/+$/, ''),
        apiKey: row.apiKey,
        updatedAt: row.updatedAt,
      };
    }
    const url = app.env.CLASSIFY_SERVICE_URL?.replace(/\/+$/, '');
    const apiKey = app.env.CLASSIFY_SERVICE_API_KEY;
    if (url && apiKey) return { source: 'env' as const, url, apiKey, updatedAt: null };
    return null;
  }

  /** Same shape of check the Workers form uses: a probe, no writes, no audit. */
  async function probe(cfg: { url: string; apiKey: string }) {
    const started = Date.now();
    const get = (path: string, auth: boolean) =>
      fetch(`${cfg.url}${path}`, {
        headers: auth ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    try {
      const health = await get('/health', false);
      if (!health.ok) {
        return {
          ok: false,
          error: `Service answered HTTP ${health.status} on /health`,
          latencyMs: Date.now() - started,
        };
      }
      const body = (await health.json()) as { model?: string };
      // /health is open, so a wrong key only shows up on an authenticated route.
      const auth = await get('/logs?limit=1', true);
      const latencyMs = Date.now() - started;
      if (auth.status === 401)
        return { ok: false, error: 'Reachable, but the API key was rejected', latencyMs };
      if (!auth.ok)
        return { ok: false, error: `Key check answered HTTP ${auth.status}`, latencyMs };
      return { ok: true, error: null, latencyMs, model: body.model ?? null };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Connection timed out'
          : err instanceof Error
            ? err.message
            : 'Connection failed';
      return { ok: false, error: message, latencyMs };
    }
  }

  async function callService(path: string, auth: boolean) {
    const cfg = await effectiveConfig();
    if (!cfg) return { ok: false as const, error: 'not_configured' };
    const started = Date.now();
    try {
      const res = await fetch(`${cfg.url}${path}`, {
        headers: auth ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false as const, error: `http_${res.status}` };
      return { ok: true as const, body: await res.json(), rttMs: Date.now() - started };
    } catch (err) {
      app.log.warn({ err }, 'classify service request failed');
      return { ok: false as const, error: 'unreachable' };
    }
  }

  const keyHint = (key: string) => (key.length > 6 ? `...${key.slice(-6)}` : '******');

  app.get('/admin/classify-service/config', { preHandler: R }, async () => {
    const cfg = await effectiveConfig();
    return cfg
      ? {
          source: cfg.source,
          url: cfg.url,
          apiKeyHint: keyHint(cfg.apiKey),
          updatedAt: cfg.updatedAt,
        }
      : { source: 'none' as const, url: null, apiKeyHint: null, updatedAt: null };
  });

  app.put(
    '/admin/classify-service/config',
    { preHandler: requirePermission('workers.write'), schema: { body: ConfigBody } },
    async (req) => {
      const body = req.body as z.infer<typeof ConfigBody>;
      const url = body.url.replace(/\/+$/, '');
      const t = schema.classifyServiceConfig;
      return app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(t).where(eq(t.id, 'default'));
        // Keeping the key falls back through the same chain the dispatcher uses.
        const apiKey = body.apiKey ?? before?.apiKey ?? app.env.CLASSIFY_SERVICE_API_KEY;
        if (!apiKey) throw new AppError('VALIDATION', 400, 'An API key is required');
        await tx
          .insert(t)
          .values({ id: 'default', url, apiKey })
          .onConflictDoUpdate({ target: t.id, set: { url, apiKey, updatedAt: new Date() } });
        // The key itself never goes into the audit trail, only its hint.
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'classify_service.update',
          resourceType: 'classify_service',
          resourceId: 'default',
          before: before ? { url: before.url, apiKeyHint: keyHint(before.apiKey) } : null,
          after: { url, apiKeyHint: keyHint(apiKey) },
          request: req,
        });
        return { source: 'db' as const, url, apiKeyHint: keyHint(apiKey) };
      });
    },
  );

  // Back to the env-var fallback (or "not configured" when those are unset too).
  app.delete(
    '/admin/classify-service/config',
    { preHandler: requirePermission('workers.write') },
    async (req) => {
      const t = schema.classifyServiceConfig;
      await app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(t).where(eq(t.id, 'default'));
        if (!before) return;
        await tx.delete(t).where(eq(t.id, 'default'));
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'classify_service.clear',
          resourceType: 'classify_service',
          resourceId: 'default',
          before: { url: before.url, apiKeyHint: keyHint(before.apiKey) },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  // Probe a URL + key without saving. A blank key tests the stored one, so a
  // saved setup can be re-checked without retyping the secret.
  app.post(
    '/admin/classify-service/test-connection',
    { preHandler: requirePermission('workers.read'), schema: { body: ConfigBody } },
    async (req) => {
      const body = req.body as z.infer<typeof ConfigBody>;
      const apiKey = body.apiKey ?? (await effectiveConfig())?.apiKey;
      if (!apiKey) return { ok: false, error: 'No API key to test with', latencyMs: 0 };
      return probe({ url: body.url.replace(/\/+$/, ''), apiKey });
    },
  );

  app.get('/admin/classify-service/status', { preHandler: R }, async () => {
    const cfg = await effectiveConfig();
    // Host only: the key stays out of the response and so does any path.
    const host = cfg ? new URL(cfg.url).host : null;
    const health = await callService('/health', false);
    return {
      configured: cfg !== null,
      host,
      reachable: health.ok,
      error: health.ok ? null : health.error,
      rttMs: health.ok ? health.rttMs : null,
      health: health.ok ? health.body : null,
    };
  });

  app.get(
    '/admin/classify-service/logs',
    { preHandler: R, schema: { querystring: LogsQuery } },
    async (req) => {
      const { limit } = req.query as z.infer<typeof LogsQuery>;
      const res = await callService(`/logs?limit=${limit}`, true);
      if (!res.ok) return { items: [], error: res.error };
      return { items: (res.body as { items: unknown[] }).items, error: null };
    },
  );

  app.get(
    '/admin/classify-service/stats',
    { preHandler: R, schema: { querystring: StatsQuery } },
    async (req) => {
      const { hours } = req.query as z.infer<typeof StatsQuery>;
      const t = schema.garmentRecognitions;
      const since = new Date(Date.now() - hours * 3_600_000);
      const [byOutcome, [latency]] = await Promise.all([
        app.db
          .select({ outcome: t.outcome, count: sql<number>`count(*)::int` })
          .from(t)
          .where(gte(t.createdAt, since))
          .groupBy(t.outcome),
        app.db
          .select({
            p50: sql<number | null>`percentile_cont(0.5) within group (order by ${t.ms})::int`,
            p95: sql<number | null>`percentile_cont(0.95) within group (order by ${t.ms})::int`,
            lastAt: sql<string | null>`max(${t.createdAt})`,
          })
          .from(t)
          .where(and(gte(t.createdAt, since), eq(t.outcome, 'answered'))),
      ]);
      const counts = Object.fromEntries(byOutcome.map((r) => [r.outcome, r.count]));
      const total = byOutcome.reduce((n, r) => n + r.count, 0);
      return {
        hours,
        total,
        counts,
        p50Ms: latency?.p50 ?? null,
        p95Ms: latency?.p95 ?? null,
        lastAnsweredAt: latency?.lastAt ?? null,
      };
    },
  );
}

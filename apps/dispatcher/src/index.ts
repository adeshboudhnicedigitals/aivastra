import { setDefaultResultOrder } from 'node:dns';
import { hostname } from 'node:os';
import { createLogger } from '@aivastra/logger';
import * as Sentry from '@sentry/node';
import { Agent, setGlobalDispatcher } from 'undici';
import { startPerformanceRefresh } from './perf/record-sample.js';

// Node's built-in fetch (undici) ignores NODE_TLS_REJECT_UNAUTHORIZED set via dotenv
// because undici is initialised before env vars load. Override the global dispatcher
// at the earliest possible moment so all subsequent fetch() calls inherit it.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
}

import { schema } from '@aivastra/db';
import { runClassifyConsumer } from './classify/consumer.js';
import { createServiceResolver } from './classify/service-config.js';
import { loadEnv } from './env.js';
import { startHealthServer } from './health/server.js';
import { processSession } from './job/ownership.js';
import { promoteSareeStep2Jobs } from './job/saree-step2-promoter.js';
import { makeDb } from './lib/db.js';
import { makeComfyRedis, makeRedis } from './lib/redis.js';
import { makeStorage } from './lib/storage.js';
import { runShopifyRetention } from './shopify/retention.js';
import { drainAndRetire } from './shutdown.js';
import { runConsumer } from './stream/consumer.js';
import { runInhouseConsumer } from './stream/inhouse-consumer.js';
import { startRecoveryScheduler } from './stream/recovery.js';
import { runSweeper } from './stream/sweeper.js';
import { runVideoConsumer } from './stream/video-consumer.js';
import { runWebhooksConsumer } from './stream/webhooks.js';
import { startHealthMonitor } from './worker/health-monitor.js';
import {
  claimDispatcherSession,
  rebuildWorkerRegistry,
  releaseDispatcherSession,
  startReservationReconciler,
} from './worker/reservation-reconciler.js';
import { initWatermarkTile } from './workflow/watermark.js';

// Containers here have no IPv6 route, but external hosts we call (ComfyUI
// tunnels, PixVerse, R2/MinIO) can resolve AAAA. Node's Happy-Eyeballs default
// races both families with only ~250ms before falling back to IPv4 — a window
// a dead IPv6 attempt can occasionally lose outright, surfacing as a spurious
// ETIMEDOUT on an otherwise-healthy outbound call. Forcing IPv4-first removes
// the race instead of racing a leg that can never win.
setDefaultResultOrder('ipv4first');

const log = createLogger('dispatcher', { hostname: hostname() });

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    });
  }
  log.info({ NODE_ENV: env.NODE_ENV }, 'dispatcher starting');

  if (env.ENABLE_WATERMARKING) {
    try {
      await initWatermarkTile();
      log.info('watermark tile initialized');
    } catch (err) {
      log.fatal(
        { err },
        'failed to initialize watermark tile; ENABLE_WATERMARKING is true, failing closed',
      );
      process.exit(1);
    }
  }

  if (!env.PIXVERSE_API_KEY) {
    log.warn(
      'PIXVERSE_API_KEY is not set — catalog-video jobs will fail fast with PIXVERSE_NOT_CONFIGURED',
    );
  }

  const { db, close: closeDb, withAdvisoryLock } = makeDb(env);
  const { main: redis, pub, close: closeRedis } = makeRedis(env);
  // Capability deadlines must not queue behind the main connection's blocking consumers.
  const comfyRedis = makeComfyRedis(redis);
  await comfyRedis.connect();
  const storage = makeStorage(env, log);

  // One live dispatcher per Redis; a SIGKILLed predecessor only delays this until its marker lapses.
  await claimDispatcherSession(redis, processSession, log);

  // Load workers from DB (source of truth — managed via admin panel). Inactive workers are
  // registered too, as DRAINING, so a plain admin reactivation finds them after this restart;
  // unresolved remote work is rebuilt as a hold before any worker is claimable.
  const loadWorkers = () =>
    db
      .select()
      .from(schema.workers)
      // schema.workers.allowedJobTypes is a raw `text[]` column (Drizzle types it as string[]);
      // values are only constrained to WorkerPool by workerPoolSchema at the admin API write
      // boundary (apps/api/src/modules/admin/workers.routes.ts). rebuildWorkerRegistry casts at
      // the one place a DB read crosses into the precisely-typed dispatcher registry.
      .orderBy(schema.workers.createdAt);
  const allWorkers = await loadWorkers();
  const workers = allWorkers.filter((w) => w.isActive);
  if (workers.length === 0) {
    log.warn('No active workers found in DB — add workers via admin panel');
  }
  await rebuildWorkerRegistry({ db, redis, log, workers: allWorkers });
  log.info({ workerIds: workers.map((w) => w.id) }, 'workers registered from DB');

  // Startup connectivity check — verify each worker is reachable before accepting jobs
  for (const w of workers) {
    try {
      const res = await fetch(`${w.url.replace(/\/$/, '')}/system_stats`, {
        headers: { 'X-Api-Key': w.apiKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        log.info({ workerId: w.id, url: w.url }, 'ComfyUI worker reachable ✓');
      } else {
        log.warn(
          { workerId: w.id, url: w.url, status: res.status },
          'ComfyUI worker responded with non-OK status',
        );
      }
    } catch (err) {
      log.warn(
        { workerId: w.id, url: w.url, err },
        'ComfyUI worker unreachable — health monitor will retry',
      );
    }
  }

  const processorCfg = {
    db,
    withAdvisoryLock,
    redis,
    comfyRedis,
    comfyPollIntervalMs: env.COMFY_POLL_INTERVAL_MS,
    pub,
    storage,
    log,
    ownerSession: processSession,
    uncertainCheckMs: env.COMFY_UNCERTAIN_CHECK_MS,
  };
  log.info({ session: processSession }, 'dispatcher ownership session started');

  // Crash recovery: reclaim stale XPENDING entries from a previous run

  // Start subsystems
  const stopPerformanceRefresh = startPerformanceRefresh(comfyRedis);
  const stopHealthMonitor = startHealthMonitor(comfyRedis, log);
  // Immediately, then every 10 s: frees holds whose remote work has ended and keeps the
  // alert gauges fresh. Also rebuilds the registry if a Redis reset removed it.
  const stopReservationReconciler = startReservationReconciler(
    {
      db,
      redis,
      log,
      uncertainCheckMs: env.COMFY_UNCERTAIN_CHECK_MS,
      session: processSession,
    },
    async () => {
      await rebuildWorkerRegistry({ db, redis, log, workers: await loadWorkers() });
    },
  );
  const stopConsumer = await runConsumer(redis, processorCfg, log);
  // Separate lane: PixVerse video jobs need no GPU worker, so they must not be
  // gated by the GPU consumer's registry-derived in-flight cap.
  const stopVideoConsumer = await runVideoConsumer(redis, processorCfg, log, {
    concurrency: env.VIDEO_CONCURRENCY,
  });
  // WhatsApp garment recognition (spec 8a): its own stream and cap, so it never
  // waits behind try-on jobs. Harmless when unused — nothing is ever added to
  // the stream while the api's GARMENT_RECOGNITION_ENABLED is off.
  const stopClassifyConsumer = await runClassifyConsumer(redis, processorCfg, log, {
    resolveService: createServiceResolver(db, env),
  });
  // Dedicated lane for the team's own bulk try-on test runs; only workers tagged
  // 'inhouse' serve it, and production lanes never see it.
  const stopInhouseConsumer = await runInhouseConsumer(redis, processorCfg, log);
  const stopWebhooks = await runWebhooksConsumer(db, redis, log);
  const stopHealthServer = startHealthServer(env.DISPATCHER_HEALTH_PORT, log);

  const sweeperInterval = setInterval(
    () => {
      void runSweeper(db, redis, pub, log, undefined, processorCfg);
    },
    5 * 60 * 1000,
  );

  // Immediately and then every 5 s, in the background: an adoption can wait minutes and must not
  // hold up boot or the next scan. Retired rows and drained consumers are eligible at once.
  const stopRecovery = startRecoveryScheduler(
    redis,
    processorCfg,
    env.XPENDING_CLAIM_THRESHOLD_MS,
    log,
  );

  const sareeStep2Interval = setInterval(() => {
    void promoteSareeStep2Jobs(processorCfg);
  }, 5_000);

  // Hourly: retention is a slow-moving daily-granularity policy, so a tighter
  // cadence would just re-scan stores with nothing to do.
  const shopifyRetentionInterval = setInterval(
    () => {
      void runShopifyRetention(db, storage, log, withAdvisoryLock);
    },
    60 * 60 * 1000,
  );

  log.info('dispatcher ready');

  async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'shutting down dispatcher');
    clearInterval(sweeperInterval);
    stopRecovery();
    clearInterval(sareeStep2Interval);
    clearInterval(shopifyRetentionInterval);
    stopConsumer();
    stopVideoConsumer();
    stopClassifyConsumer();
    stopInhouseConsumer();
    stopWebhooks();
    stopPerformanceRefresh();
    stopHealthMonitor();
    stopReservationReconciler();
    await drainAndRetire({
      db,
      redis,
      log,
      session: processSession,
      drainMs: env.SHUTDOWN_DRAIN_MS,
    });
    stopHealthServer();
    comfyRedis.disconnect();
    await releaseDispatcherSession(redis, processSession).catch(() => {});
    await closeRedis();
    await closeDb();
    process.exit(0);
  }

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => log.error({ err }, 'shutdown error'));
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => log.error({ err }, 'shutdown error'));
  });

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandled rejection');
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });
}

main().catch(async (err) => {
  log.error({ err }, 'dispatcher crashed');
  Sentry.captureException(err);
  await Sentry.close(2000).catch(() => {});
  process.exit(1);
});

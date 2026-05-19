import { hostname } from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '@aivastra/logger';
import { loadEnv, workerUrl } from './env.js';
import { makeDb } from './lib/db.js';
import { makeRedis } from './lib/redis.js';
import { makeStorage } from './lib/storage.js';
import { registerWorkers } from './worker/registry.js';
import { startHealthMonitor } from './worker/health-monitor.js';
import { runConsumer } from './stream/consumer.js';
import { recoverPendingJobs } from './stream/recovery.js';
import { startHealthServer } from './health/server.js';

const log = createLogger('dispatcher', { hostname: hostname() });

async function main(): Promise<void> {
  const env = loadEnv();
  log.info({ NODE_ENV: env.NODE_ENV }, 'dispatcher starting');

  const { db, close: closeDb } = makeDb(env);
  const { main: redis, pub, close: closeRedis } = makeRedis(env);
  const storage = makeStorage(env);
  const s3 = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.R2_FORCE_PATH_STYLE,
  });

  // Register known workers from env
  const workerIds = env.WORKER_IDS.split(',').map((s) => s.trim());
  const workers = workerIds.map((id) => ({ id, url: workerUrl(process.env, id) }));
  await registerWorkers(redis, workers);
  log.info({ workerIds }, 'workers registered');

  const processorCfg = {
    db,
    redis,
    pub,
    storage,
    s3,
    r2Bucket: env.R2_BUCKET,
    cfClientId: env.CF_ACCESS_CLIENT_ID,
    cfClientSecret: env.CF_ACCESS_CLIENT_SECRET,
    log,
  };

  // Crash recovery: reclaim stale XPENDING entries from a previous run
  await recoverPendingJobs(redis, processorCfg, env.XPENDING_CLAIM_THRESHOLD_MS, log);

  // Start subsystems
  const stopHealthMonitor = startHealthMonitor(
    redis, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET, log,
  );
  const stopConsumer = await runConsumer(redis, processorCfg, log);
  const stopHealthServer = startHealthServer(env.DISPATCHER_HEALTH_PORT, log);

  log.info('dispatcher ready');

  async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'shutting down dispatcher');
    stopConsumer();
    stopHealthMonitor();
    stopHealthServer();
    await closeRedis();
    await closeDb();
    process.exit(0);
  }

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch((err) => log.error({ err }, 'shutdown error')); });
  process.on('SIGINT', () => { shutdown('SIGINT').catch((err) => log.error({ err }, 'shutdown error')); });
}

main().catch((err) => {
  log.error({ err }, 'dispatcher crashed');
  process.exit(1);
});

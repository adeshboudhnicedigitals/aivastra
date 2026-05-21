/**
 * Register GPU worker VPSes in Redis worker:registry hash.
 * Run once after tunnel is confirmed working.
 *
 * Usage:
 *   WORKER_IDS=worker-a,worker-b \
 *   WORKER_A_URL=https://UUID.cfargotunnel.com \
 *   WORKER_B_URL=https://UUID2.cfargotunnel.com \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   pnpm tsx scripts/register-workers.ts
 *
 * To deregister a worker:
 *   DEREGISTER=worker-a pnpm tsx scripts/register-workers.ts
 */

import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const WORKER_IDS = (process.env.WORKER_IDS ?? '').split(',').filter(Boolean);
const DEREGISTER = process.env.DEREGISTER;

const redis = new Redis(REDIS_URL);

function workerUrl(id: string): string {
  const key = `WORKER_${id.toUpperCase().replace(/-/g, '_')}_URL`;
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var ${key}`);
  return val;
}

async function main() {
  if (DEREGISTER) {
    await redis.hdel('worker:registry', DEREGISTER);
    await redis.del(`worker:health:${DEREGISTER}`);
    console.log(`Deregistered worker: ${DEREGISTER}`);
    return;
  }

  if (!WORKER_IDS.length) {
    console.error('Set WORKER_IDS=worker-a,worker-b');
    process.exit(1);
  }

  for (const id of WORKER_IDS) {
    const url = workerUrl(id);
    const entry = JSON.stringify({ id, url, status: 'IDLE', lastSeen: 0 });
    await redis.hset('worker:registry', id, entry);
    await redis.setex(`worker:health:${id}`, 30, '1');
    console.log(`Registered ${id} → ${url}`);
  }

  const all = await redis.hgetall('worker:registry');
  console.log('\nCurrent registry:');
  for (const [k, v] of Object.entries(all)) {
    console.log(`  ${k}: ${v}`);
  }
}

main().finally(() => redis.disconnect());

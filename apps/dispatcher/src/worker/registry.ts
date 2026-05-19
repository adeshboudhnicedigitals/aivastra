import type { Redis } from 'ioredis';

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING';

export interface WorkerEntry {
  url: string;
  status: WorkerStatus;
  lastSeen: number; // unix ms
}

export const REGISTRY_KEY = 'worker:registry';

export function healthKey(workerId: string) {
  return `worker:health:${workerId}`;
}

export async function getWorkers(redis: Redis): Promise<Map<string, WorkerEntry>> {
  const raw = await redis.hgetall(REGISTRY_KEY);
  const map = new Map<string, WorkerEntry>();
  for (const [id, json] of Object.entries(raw)) {
    try { map.set(id, JSON.parse(json) as WorkerEntry); } catch { /* skip malformed */ }
  }
  return map;
}

export async function setWorkerStatus(
  redis: Redis,
  workerId: string,
  status: WorkerStatus,
): Promise<void> {
  const workers = await getWorkers(redis);
  const entry = workers.get(workerId);
  if (!entry) return;
  entry.status = status;
  entry.lastSeen = Date.now();
  await redis.hset(REGISTRY_KEY, workerId, JSON.stringify(entry));
}

export async function registerWorkers(
  redis: Redis,
  workers: Array<{ id: string; url: string }>,
): Promise<void> {
  for (const w of workers) {
    const entry: WorkerEntry = { url: w.url, status: 'IDLE', lastSeen: Date.now() };
    await redis.hset(REGISTRY_KEY, w.id, JSON.stringify(entry));
  }
}

export async function deregisterWorker(
  redis: Redis,
  workerId: string,
): Promise<void> {
  await redis.hdel(REGISTRY_KEY, workerId);
  await redis.del(healthKey(workerId));
}

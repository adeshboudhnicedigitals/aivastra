import type { Redis } from 'ioredis';
import { ADMISSION_KEY, RESERVATIONS_KEY, setWorkerStatus } from '../../src/worker/registry.js';

/** Test reset: a worker back to IDLE with no hold, as a fresh registry build would leave it. */
export async function forceIdle(redis: Redis, workerId: string): Promise<void> {
  await redis.hdel(RESERVATIONS_KEY, workerId);
  await setWorkerStatus(redis, workerId, 'IDLE');
}

/** For fixtures that write registry entries by hand: marks the registry as built. */
export async function openAdmission(redis: Redis): Promise<void> {
  await redis.set(ADMISSION_KEY, '1');
}

import type { Logger } from '@aivastra/logger';
import {
  comfyCapabilityUnreadable,
  comfyGateDrift,
  comfyVersionMismatch,
} from '@aivastra/observability';
import {
  type CapabilityRead,
  capabilitiesKey,
  comfyVersionKey,
  parseCapabilities,
} from '@aivastra/types';
import type { Redis } from 'ioredis';
import { boundedRead } from './bounded-read.js';
import { isQueueGateEnabled } from './registry.js';

export { boundedRead } from './bounded-read.js';

export async function readCapabilities(
  redis: Redis,
  id: string,
  context: string,
  timeoutMs: number,
  log?: Pick<Logger, 'error'>,
): Promise<CapabilityRead> {
  let read: CapabilityRead;
  try {
    read = parseCapabilities(await boundedRead(() => redis.get(capabilitiesKey(id)), timeoutMs));
  } catch {
    read = { status: 'unreadable' };
  }
  if (read.status === 'unreadable') {
    comfyCapabilityUnreadable.inc({ workerId: id, context });
    log?.error({ workerId: id, context }, 'worker capabilities unreadable');
  }
  return read;
}

export async function versionMatches(
  redis: Redis,
  id: string,
  read: CapabilityRead,
  timeoutMs: number,
  log?: Pick<Logger, 'error'>,
): Promise<boolean> {
  if (read.status !== 'configured') return false;
  let version: string | null = null;
  try {
    version = await boundedRead(() => redis.get(comfyVersionKey(id)), timeoutMs);
  } catch {
    /* fail closed */
  }
  if (version !== null && version === read.capabilities.validatedComfyVersion) return true;
  comfyVersionMismatch.inc({ workerId: id });
  log?.error({ workerId: id }, 'worker validated ComfyUI version missing or mismatched');
  return false;
}

export async function detectCapabilityDrift(redis: Redis, id: string, log: Logger): Promise<void> {
  const deadline = Date.now() + 5_000;
  const remaining = () => Math.max(0, deadline - Date.now());
  const read = await readCapabilities(redis, id, 'monitor', remaining(), log);
  if (read.status !== 'configured') return;
  await versionMatches(redis, id, read, remaining(), log);
  if (!(await boundedRead(() => isQueueGateEnabled(redis, id), remaining()))) {
    comfyGateDrift.inc({ workerId: id });
    log.error({ workerId: id }, 'configured worker lacks queue gate protection');
  }
}

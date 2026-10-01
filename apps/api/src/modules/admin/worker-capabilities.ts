import { comfyCapabilityUnreadable } from '@aivastra/observability';
import { type CapabilityRead, capabilitiesKey, parseCapabilities } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

export async function readWorkerCapabilities(
  app: FastifyInstance,
  id: string,
  mutation = false,
): Promise<CapabilityRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let read: CapabilityRead;
  try {
    const raw = await Promise.race([
      app.redis.get(capabilitiesKey(id)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('capability read timed out')), 5_000);
      }),
    ]);
    read = parseCapabilities(raw);
  } catch {
    if (mutation === true) {
      comfyCapabilityUnreadable.inc({ workerId: id, context: 'admin_mutation' });
      app.log.error({ workerId: id }, 'worker capability read failed');
    }
    // Redis failure cannot be interpreted as permission to repair even while draining.
    if (mutation)
      throw new AppError('CAPABILITIES_UNREADABLE', 503, 'Worker capability read failed');
    return { status: 'unreadable' };
  } finally {
    clearTimeout(timer);
  }
  // Display reads return warnings only; periodic monitoring owns operational alerts.
  if (mutation === true && read.status === 'unreadable') {
    comfyCapabilityUnreadable.inc({ workerId: id, context: 'admin_mutation' });
    app.log.error({ workerId: id }, 'worker capabilities malformed');
  }
  return read;
}

export async function requireCapabilityDrain(app: FastifyInstance, id: string): Promise<void> {
  const read = await readWorkerCapabilities(app, id, true);
  if (read.status === 'not_configured') return;
  const raw = await app.redis.hget('worker:registry', id);
  if (!raw || (JSON.parse(raw) as { status?: unknown }).status !== 'DRAINING') {
    throw new AppError(
      'WORKER_CAPABILITIES_PROTECTED',
      409,
      'Drain and verify an empty ComfyUI queue first',
    );
  }
}

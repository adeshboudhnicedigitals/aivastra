import type { Logger } from '@aivastra/logger';
import {
  comfyCancelTotal,
  comfyConfigLoss,
  comfyDeleteFailures,
  comfyDestructiveSkipped,
} from '@aivastra/observability';
import type { CapabilityRead } from '@aivastra/types';
import type { Redis } from 'ioredis';
import type { ComfyTimeoutConfig } from '../config/comfy-timeout.js';
import { readCapabilities, versionMatches } from '../worker/capabilities.js';
import {
  deleteQueuedPrompt,
  fetchPromptQueueState,
  interruptPrompt,
  interruptScopedPrompt,
} from './client.js';

export type ComfyLog = Pick<Logger, 'info' | 'debug' | 'error'> & Partial<Pick<Logger, 'warn'>>;
export interface CompletionContext {
  redis: Redis;
  workerId: string;
}

export class JobCancelledError extends Error {
  constructor(promptId: string) {
    super(`job cancelled by user while ComfyUI prompt ${promptId} was running`);
    this.name = 'JobCancelledError';
  }
}

export function hasSafeCancelCapabilities(read: CapabilityRead): boolean {
  return (
    read.status === 'configured' &&
    read.capabilities.queuePromptIdentityValidated === true &&
    read.capabilities.queueDeleteValidated === true &&
    read.capabilities.promptScopedInterruptValidated === true
  );
}

export async function cancelPrompt(
  workerUrl: string,
  apiKey: string,
  promptId: string,
  eligibleAtStart: boolean,
  config: ComfyTimeoutConfig,
  context: CompletionContext | undefined,
  log?: ComfyLog,
): Promise<never> {
  const deadline = Date.now() + config.cancelConfirmationTimeoutMs;
  const workerId = context?.workerId ?? 'unknown';
  const remaining = () => Math.max(0, Math.min(config.requestTimeoutMs, deadline - Date.now()));
  const read = () =>
    context
      ? readCapabilities(context.redis, workerId, 'cancel', remaining(), log)
      : Promise.resolve<CapabilityRead>({ status: 'unreadable' });
  const safe = async (capabilities: CapabilityRead) =>
    context &&
    hasSafeCancelCapabilities(capabilities) &&
    (await versionMatches(context.redis, workerId, capabilities, remaining(), log));
  let skippedOperation: string | undefined;
  const skipped = (operation: string) => {
    skippedOperation = operation;
    comfyDestructiveSkipped.inc({ workerId, operation });
    log?.error(
      { workerId, promptId, skipped_operation: operation },
      'cancel destructive call denied by live authorization',
    );
  };
  const finish = (mode: string, outcome: string): never => {
    comfyCancelTotal.inc({ workerId, mode, outcome });
    const fields = {
      workerId,
      promptId,
      cancel_mode: mode,
      cancel_outcome: outcome,
      skipped_operation: skippedOperation,
    };
    if (mode === 'conservative' || (outcome !== 'confirmed' && mode !== 'legacy'))
      log?.error(fields, 'cancel left prompt state unconfirmed — release worker');
    else log?.info(fields, 'ComfyUI cancellation finished');
    throw new JobCancelledError(promptId);
  };
  const current = await read();
  if (eligibleAtStart && current.status === 'not_configured') {
    // The fresh read closes an enablement race between mode selection and interrupt.
    const authorization = await read();
    if (authorization.status !== 'not_configured' || remaining() <= 0) {
      skipped('legacy_interrupt');
      return finish('conservative', 'authorization_denied');
    }
    try {
      await interruptPrompt(workerUrl, apiKey, log, remaining());
    } catch (err) {
      log?.error({ err, workerId, promptId }, 'legacy interrupt failed');
    }
    return finish('legacy', 'unconfirmed');
  }
  if (!(await safe(current))) {
    if (!eligibleAtStart && current.status === 'not_configured') {
      comfyConfigLoss.inc({ workerId });
      log?.error(
        { workerId, promptId },
        'cancel ratchet prevented unscoped interrupt after configuration loss',
      );
    }
    return finish('conservative', 'authorization_denied');
  }
  const authorized = async (operation: string) => {
    const allowed = await safe(await read());
    if (!allowed || remaining() <= 0) {
      skipped(operation);
      return false;
    }
    return true;
  };
  if (!(await authorized('delete'))) return finish('conservative', 'authorization_denied');
  const deletePrompt = async () => {
    try {
      await deleteQueuedPrompt(workerUrl, apiKey, promptId, remaining());
    } catch (err) {
      comfyDeleteFailures.inc({ workerId });
      log?.error({ err, workerId, promptId }, 'scoped cancel delete failed');
    }
  };
  await deletePrompt();
  let weakened = false;
  if (await authorized('interrupt')) {
    try {
      await interruptScopedPrompt(workerUrl, apiKey, promptId, remaining());
    } catch (err) {
      log?.error({ err, workerId, promptId }, 'scoped cancel interrupt failed');
    }
  } else weakened = true;

  let absentSince: number | undefined;
  while (remaining() > 0) {
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, '')}/history/${promptId}`, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(remaining()),
      });
      if (res.ok && ((await res.json()) as Record<string, unknown>)[promptId])
        return finish('safe_scoped', weakened ? 'authorization_weakened' : 'confirmed');
    } catch (err) {
      if (err instanceof JobCancelledError) throw err;
      log?.debug({ workerId, promptId }, 'cancel history unreadable');
    }
    if (remaining() <= 0) break;
    try {
      const state = await fetchPromptQueueState(workerUrl, apiKey, promptId, remaining());
      if (state === 'absent') {
        if (absentSince !== undefined && Date.now() - absentSince >= config.cancelAbsentRecheckMs)
          return finish('safe_scoped', weakened ? 'authorization_weakened' : 'confirmed');
        absentSince ??= Date.now();
      } else {
        absentSince = undefined;
        if (state === 'pending' && (await authorized('delete'))) await deletePrompt();
      }
    } catch (err) {
      if (err instanceof JobCancelledError) throw err;
      absentSince = undefined;
      log?.debug({ workerId, promptId }, 'cancel queue unreadable');
    }
    const sleepMs = Math.min(config.cancelAbsentRecheckMs, deadline - Date.now());
    if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  return finish('safe_scoped', weakened ? 'authorization_weakened' : 'unconfirmed');
}

import {
  comfyDeleteFailures,
  comfyDestructiveSkipped,
  comfyLegacyFallback,
  comfyPromptQueueWait,
  comfyQueueCleanupFailed,
} from '@aivastra/observability';
import type { CapabilityRead } from '@aivastra/types';
import {
  comfyTimeoutConfigSchema,
  getComfyTimeoutConfig,
  POLL_INTERVAL_MS,
} from '../config/comfy-timeout.js';
import { boundedRead, readCapabilities, versionMatches } from '../worker/capabilities.js';
import { isQueueGateEnabled } from '../worker/registry.js';
import { type ComfyLog, type CompletionContext, cancelPrompt } from './cancel.js';
import { deleteQueuedPrompt, fetchPromptQueueState } from './client.js';

export { JobCancelledError } from './cancel.js';

export interface ProgressUpdate {
  node: string | null;
  value: number;
  max: number;
}
export type ProgressCallback = (update: ProgressUpdate) => void;
export type WaitForCompletionResult = { status: 'completed' } | { status: 'queue_cleanup_failed' };

export function assertNever(value: never): never {
  throw new Error(`Unexpected completion result: ${JSON.stringify(value)}`);
}

/** Poll history first: outputs can arrive between polls without ever observing RUNNING. */
export async function waitForCompletion(
  workerUrl: string,
  apiKey: string,
  _clientUuid: string,
  promptId: string,
  timeoutMs = 300_000,
  _onProgress?: ProgressCallback,
  log?: ComfyLog,
  isCancelled?: () => Promise<boolean>,
  context?: CompletionContext,
): Promise<WaitForCompletionResult> {
  const submittedAt = Date.now();
  const workerId = context?.workerId ?? 'unknown';
  const startRead: CapabilityRead = context
    ? await readCapabilities(context.comfyRedis, workerId, 'submission', 5_000, log)
    : { status: 'unreadable' };
  const { config, reason: budgetReason } = context
    ? await getComfyTimeoutConfig(context.comfyRedis)
    : { config: comfyTimeoutConfigSchema.parse({}), reason: 'context_unavailable' };
  let reason = budgetReason ?? 'capabilities_not_effective';
  let enabled = false;
  if (
    context &&
    config.maxQueueWaitMs &&
    startRead.status === 'configured' &&
    startRead.capabilities.queuePromptIdentityValidated === true &&
    startRead.capabilities.queueDeleteValidated === true &&
    (await versionMatches(context.comfyRedis, workerId, startRead, config.requestTimeoutMs, log))
  ) {
    try {
      enabled = await boundedRead(
        () => isQueueGateEnabled(context.comfyRedis, workerId),
        config.requestTimeoutMs,
      );
    } catch {
      /* Missing protection disables the timeout feature. */
    }
    reason = enabled ? 'validated' : 'queue_gate_off_or_unreadable';
  }
  let mode: 'PRE_START' | 'RUNNING' | 'LEGACY_FALLBACK' = enabled ? 'PRE_START' : 'LEGACY_FALLBACK';
  let deadline = submittedAt + timeoutMs;
  let unknownSince: number | undefined;
  let consecutiveQueueErrors = 0;
  if (!enabled) comfyLegacyFallback.inc({ workerId, entry: 'start' });
  log?.info(
    { workerId, promptId, mode: enabled ? 'queue_aware' : 'legacy', reason, ...config },
    'ComfyUI completion mode',
  );
  const fallback = (why: string) => {
    const legacyEnteredAt = Date.now();
    mode = 'LEGACY_FALLBACK';
    deadline = Math.max(submittedAt + timeoutMs, legacyEnteredAt + timeoutMs);
    comfyLegacyFallback.inc({ workerId, entry: 'midflight' });
    (log?.warn ?? log?.info)?.(
      { workerId, promptId, legacyEnteredAt, deadline, reason: why },
      'ComfyUI queue observation lost — legacy fallback',
    );
  };
  const url = `${workerUrl.replace(/\/$/, '')}/history/${promptId}`;
  const executionTimedOut = () =>
    new Error(`ComfyUI history polling timeout after ${timeoutMs}ms for prompt ${promptId}`);
  while (true) {
    if (mode === 'LEGACY_FALLBACK' && Date.now() >= deadline) throw executionTimedOut();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    if (isCancelled && (await isCancelled()) === true) {
      await cancelPrompt(
        workerUrl,
        apiKey,
        promptId,
        startRead.status === 'not_configured',
        config,
        context,
        log,
      );
    }
    const queueBudgetExhausted =
      mode === 'PRE_START' &&
      config.maxQueueWaitMs !== undefined &&
      Date.now() > submittedAt + config.maxQueueWaitMs;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(queueBudgetExhausted ? config.requestTimeoutMs : 10_000),
      });
    } catch (err) {
      if (!queueBudgetExhausted) throw err;
      res = new Response('{}');
    }

    if (!res.ok && !queueBudgetExhausted) {
      log?.debug({ status: res.status }, 'ComfyUI /history not ready yet');
      if (
        (mode === 'RUNNING' && Date.now() > deadline) ||
        (mode === 'LEGACY_FALLBACK' && Date.now() >= deadline)
      )
        throw new Error(
          `ComfyUI history polling timeout after ${timeoutMs}ms for prompt ${promptId}`,
        );
      continue;
    }

    let history: Record<string, unknown>;
    try {
      history = (res.ok ? await res.json() : {}) as Record<string, unknown>;
    } catch (err) {
      if (!queueBudgetExhausted) throw err;
      history = {};
    }
    const entry = history[promptId] as
      | {
          outputs?: Record<string, unknown>;
          status?: { status_str?: string; messages?: [string, Record<string, unknown>][] };
        }
      | undefined;

    if (entry?.status?.status_str === 'error') {
      // ComfyUI's /history status_str alone ("error") drops the actual cause — the
      // node/exception detail lives in status.messages under an "execution_error" entry.
      // Surface it so failures are diagnosable from dispatcher logs without needing to
      // separately query the worker or its own process logs.
      const errorMsg = entry.status?.messages?.find(([type]) => type === 'execution_error')?.[1];
      const detail = errorMsg
        ? `${errorMsg.node_type ?? '?'} (node ${errorMsg.node_id ?? '?'}): ${errorMsg.exception_message ?? errorMsg.exception_type ?? 'unknown'}`
        : 'no execution_error detail in ComfyUI history';
      log?.info({ promptId, comfyError: errorMsg }, 'ComfyUI execution error detail');
      throw new Error(`ComfyUI execution error for prompt ${promptId}: ${detail}`);
    }

    if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
      log?.info({ promptId }, 'ComfyUI generation complete');
      return { status: 'completed' };
    }

    if (
      mode === 'PRE_START' &&
      config.maxQueueWaitMs !== undefined &&
      Date.now() > submittedAt + config.maxQueueWaitMs
    ) {
      const cleanupDeadline = Date.now() + config.queueCleanupTimeoutMs;
      const remaining = () =>
        Math.max(0, Math.min(config.requestTimeoutMs, cleanupDeadline - Date.now()));
      let absentSince: number | undefined;
      let cleanupConfirmed = false;
      // Reconcile before deleting: the prompt may have started between history and queue reads.
      while (remaining() > 0) {
        if (isCancelled && (await isCancelled()) === true)
          await cancelPrompt(
            workerUrl,
            apiKey,
            promptId,
            startRead.status === 'not_configured',
            config,
            context,
            log,
          );
        try {
          const reconciliation = await fetch(url, {
            headers: { 'X-Api-Key': apiKey },
            signal: AbortSignal.timeout(remaining()),
          });
          if (!reconciliation.ok) throw new Error('cleanup history unavailable');
          const latest = (await reconciliation.json()) as Record<
            string,
            { outputs?: Record<string, unknown>; status?: { status_str?: string } }
          >;
          if (latest[promptId]?.status?.status_str === 'error')
            throw new Error(`ComfyUI execution error for prompt ${promptId}`);
          if (Object.keys(latest[promptId]?.outputs ?? {}).length > 0)
            return { status: 'completed' };
          if (remaining() <= 0) break;
          const state = await fetchPromptQueueState(workerUrl, apiKey, promptId, remaining());
          if (state === 'running') {
            mode = 'RUNNING';
            deadline = Date.now() + timeoutMs;
            comfyPromptQueueWait.observe({ workerId }, (Date.now() - submittedAt) / 1000);
            break;
          }
          if (state === 'absent') {
            absentSince ??= Date.now();
            if (Date.now() - absentSince >= config.queueStateUnknownGraceMs && remaining() > 0) {
              const finalHistory = await fetch(url, {
                headers: { 'X-Api-Key': apiKey },
                signal: AbortSignal.timeout(remaining()),
              });
              if (!finalHistory.ok) throw new Error('cleanup final history unavailable');
              const final = (await finalHistory.json()) as Record<
                string,
                { outputs?: Record<string, unknown>; status?: { status_str?: string } }
              >;
              if (final[promptId]?.status?.status_str === 'error')
                throw new Error(`ComfyUI execution error for prompt ${promptId}`);
              if (Object.keys(final[promptId]?.outputs ?? {}).length > 0)
                return { status: 'completed' };
              cleanupConfirmed = true;
              break;
            }
          } else {
            absentSince = undefined;
            const authorization = context
              ? await readCapabilities(
                  context.comfyRedis,
                  workerId,
                  'timeout_delete',
                  remaining(),
                  log,
                )
              : ({ status: 'unreadable' } as CapabilityRead);
            if (
              context &&
              authorization.status === 'configured' &&
              authorization.capabilities.queuePromptIdentityValidated === true &&
              authorization.capabilities.queueDeleteValidated === true &&
              (await versionMatches(
                context.comfyRedis,
                workerId,
                authorization,
                remaining(),
                log,
              )) &&
              remaining() > 0
            ) {
              try {
                await deleteQueuedPrompt(workerUrl, apiKey, promptId, remaining());
              } catch (err) {
                comfyDeleteFailures.inc({ workerId });
                throw err;
              }
            } else {
              comfyDestructiveSkipped.inc({ workerId, operation: 'timeout_delete' });
              log?.error(
                { workerId, promptId, skipped_operation: 'timeout_delete' },
                'queue cleanup delete denied by live authorization',
              );
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('ComfyUI execution error')) throw err;
          absentSince = undefined;
          log?.debug({ workerId, promptId, err }, 'ComfyUI queue cleanup observation failed');
        }
        const delay = Math.min(POLL_INTERVAL_MS, cleanupDeadline - Date.now());
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (mode !== 'RUNNING') {
        comfyQueueCleanupFailed.inc({ workerId });
        log?.error(
          { workerId, promptId, cleanupConfirmed },
          'ComfyUI queue budget exhausted — terminate and refund after bounded cleanup',
        );
        return { status: 'queue_cleanup_failed' };
      }
    }
    if (mode === 'PRE_START') {
      try {
        const state = await fetchPromptQueueState(workerUrl, apiKey, promptId);
        consecutiveQueueErrors = 0;
        if (state === 'running') {
          const firstObservedRunningAt = Date.now();
          mode = 'RUNNING';
          deadline = firstObservedRunningAt + timeoutMs;
          unknownSince = undefined;
          comfyPromptQueueWait.observe({ workerId }, (firstObservedRunningAt - submittedAt) / 1000);
          log?.info(
            { workerId, promptId, firstObservedRunningAt, deadline },
            'ComfyUI execution first observed',
          );
        } else if (state === 'pending') unknownSince = undefined;
        else {
          unknownSince ??= Date.now();
          if (Date.now() - unknownSince >= config.queueStateUnknownGraceMs)
            fallback('unknown_state_grace');
        }
      } catch (err) {
        consecutiveQueueErrors++;
        if (consecutiveQueueErrors >= 3) fallback('queue_read_failures');
        else log?.debug({ workerId, promptId, err }, 'ComfyUI queue read failed');
      }
    }
    if (
      (mode === 'RUNNING' && Date.now() > deadline) ||
      (mode === 'LEGACY_FALLBACK' && Date.now() >= deadline)
    ) {
      throw new Error(
        `ComfyUI history polling timeout after ${timeoutMs}ms for prompt ${promptId}`,
      );
    }
    log?.debug({ promptId }, 'ComfyUI still generating…');
  }
}

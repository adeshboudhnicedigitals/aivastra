import { garmentClassifyDurationSeconds } from '@aivastra/observability';
import {
  GARMENT_RECOGNITION_RESULT_TTL_SEC,
  type GarmentRecognitionRequest,
  type GarmentRecognitionResult,
  garmentRecognitionResultKey,
  WORKER_POOL,
} from '@aivastra/types';
import { fetchPromptOutcome, submitPrompt, uploadImageToComfy } from '../comfyui/client.js';
import type { ProcessorConfig } from '../job/processor.js';
import { releaseWorker } from '../worker/registry.js';
import { selectWorker } from '../worker/selector.js';
import { recordRecognition } from './record.js';
import { buildClassifyPrompt, loadClassifyTemplate, readAnswer } from './workflow.js';

// Fast enough that a 1 s answer reaches the seller well inside the 12 s budget.
const POLL_MS = 250;
// Long enough for a cold Qwen load (~37 s, Finding 8): the answer is late for
// the seller but its duration is the evidence spec 8a's switch-to-API rule needs.
const HARD_CAP_MS = 90_000;

/**
 * One recognition request, end to end. Always writes a result (D53) and
 * returns it; never throws. The api decides whether the answer matches an
 * option, and ignores a result that arrives after its own budget.
 */
export async function processRecognitionRequest(
  cfg: ProcessorConfig,
  request: GarmentRecognitionRequest,
  opts: { pollMs?: number; hardCapMs?: number } = {},
): Promise<GarmentRecognitionResult> {
  const log = cfg.log.child({ lane: 'classify', requestId: request.requestId });
  const startedAt = Date.now();

  const finish = async (
    answer: string | null,
    error: GarmentRecognitionResult['error'],
    ctx: { workerId?: string | null; workflowTemplateId?: string | null } = {},
  ): Promise<GarmentRecognitionResult> => {
    const result: GarmentRecognitionResult = { answer, error, ms: Date.now() - startedAt };
    garmentClassifyDurationSeconds.observe({ outcome: error ?? 'answered' }, result.ms / 1000);
    try {
      await cfg.redis.set(
        garmentRecognitionResultKey(request.requestId),
        JSON.stringify(result),
        'EX',
        GARMENT_RECOGNITION_RESULT_TTL_SEC,
      );
    } catch (err) {
      log.warn({ err }, 'could not write garment recognition result');
    }
    // D54: one record row per request on every path, best effort — a failed
    // insert is logged inside and never changes the answer above.
    await recordRecognition(
      cfg.db,
      {
        id: request.requestId,
        gender: request.gender ?? null,
        garmentKey: request.garmentKey,
        options: request.options,
        answer,
        outcome: error ?? 'answered',
        ms: result.ms,
        workerId: ctx.workerId ?? null,
        workflowTemplateId: ctx.workflowTemplateId ?? null,
      },
      log,
    );
    return result;
  };

  // The seller already has the garment-type list: GPU time would be wasted.
  if (Date.now() > request.expiresAt) return finish(null, 'expired');

  const template = await loadClassifyTemplate(cfg.db).catch((err) => {
    log.error({ err }, 'loading the classify workflow failed');
    return null;
  });
  if (!template) {
    log.error(
      'no active classify workflow — upload one in admin (Workflows → Garment recognition)',
    );
    return finish(null, 'failed');
  }

  const worker = await selectWorker(cfg.redis, WORKER_POOL.CLASSIFY, undefined, { log }).catch(
    (err) => {
      log.warn({ err }, 'classify worker selection failed');
      return null;
    },
  );
  if (!worker) return finish(null, 'no_worker', { workflowTemplateId: template.id });

  try {
    const bytes = await cfg.storage.getObject(request.garmentKey);
    const filename = await uploadImageToComfy(
      worker.url,
      worker.apiKey,
      bytes,
      `classify_${request.requestId}.jpg`,
      'image/jpeg',
      log,
    );
    const prompt = buildClassifyPrompt(template, filename, request.options);
    const { promptId } = await submitPrompt(
      worker.url,
      worker.apiKey,
      request.requestId,
      prompt,
      log,
    );

    const deadline = Date.now() + (opts.hardCapMs ?? HARD_CAP_MS);
    while (Date.now() < deadline) {
      const outcome = await fetchPromptOutcome(worker.url, worker.apiKey, promptId);
      if (outcome.state === 'error') {
        log.warn({ workerId: worker.id, message: outcome.message }, 'classify workflow failed');
        return finish(null, 'failed', {
          workerId: worker.id,
          workflowTemplateId: template.id,
        });
      }
      if (outcome.state === 'done')
        return finish(readAnswer(outcome.outputs, template.outputNodeId), null, {
          workerId: worker.id,
          workflowTemplateId: template.id,
        });
      await new Promise((r) => setTimeout(r, opts.pollMs ?? POLL_MS));
    }
    log.warn(
      { workerId: worker.id, promptId },
      'classify workflow did not finish within the hard cap',
    );
    return finish(null, 'failed', { workerId: worker.id, workflowTemplateId: template.id });
  } catch (err) {
    log.warn({ err, workerId: worker.id }, 'classify request failed');
    return finish(null, 'failed', { workerId: worker.id, workflowTemplateId: template.id });
  } finally {
    await releaseWorker(cfg.redis, worker.id, log);
  }
}

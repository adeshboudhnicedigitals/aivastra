import { randomUUID } from 'node:crypto';
import {
  garmentClassifyCorrectedTotal,
  garmentClassifyOutcomeTotal,
} from '@aivastra/observability';
import {
  GARMENT_RECOGNITION_STREAM,
  type GarmentRecognitionRequest,
  GarmentRecognitionResult,
  garmentRecognitionResultKey,
} from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { getCatalogOptions } from '../../lib/catalog-options-cache.js';

// Spec 8a: the seller waits at most this long after the gender tap.
export const RECOGNITION_BUDGET_MS = 8_000;
const POLL_MS = 200;
// Only bounds the stream if no dispatcher is consuming it; a request is
// worthless once its budget has passed anyway.
const STREAM_MAXLEN = 1000;

export interface RecognitionCandidate {
  id: string;
  slug: string;
  label: string;
}

type Outcome = 'matched' | 'unmatched' | 'timeout' | 'no_worker' | 'failed';
const count = (outcome: Outcome) => garmentClassifyOutcomeTotal.inc({ outcome });

/**
 * The model's answer → one option, or null. An exact slug match once case,
 * surrounding whitespace, quotes and trailing punctuation are removed. Nothing
 * looser: a fuzzy match that picks the wrong type costs the seller a wrong
 * generation, while no match only costs them one tap on the list.
 */
export function matchAnswer(
  answer: string | null,
  candidates: RecognitionCandidate[],
): RecognitionCandidate | null {
  if (!answer) return null;
  const a = answer
    .trim()
    .toLowerCase()
    .replace(/^["'`]+/, '')
    .replace(/["'`.!]+$/, '');
  return candidates.find((c) => c.slug === a) ?? null;
}

async function waitForResult(
  app: FastifyInstance,
  requestId: string,
  budgetMs: number,
): Promise<GarmentRecognitionResult | null> {
  const key = garmentRecognitionResultKey(requestId);
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const raw = await app.redis.get(key);
    if (raw) {
      const parsed = GarmentRecognitionResult.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : { answer: null, error: 'failed', ms: 0 };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

/**
 * Spec 8a. Asks the dispatcher to recognise the garment among this gender's
 * types that have a public slug, and waits up to the budget. Returns null for
 * every kind of failure — the bot then shows the garment-type list, so
 * recognition can cost the seller a tap but never a run.
 *
 * The options are the dev API's cached list (catalog-options-cache.ts), whose
 * `slug` is garment_subcategories.public_api_slug: unique table-wide, so the
 * answer names exactly one row with no further matching.
 */
export async function recognizeGarment(
  app: FastifyInstance,
  garmentKey: string,
  gender: string,
  opts: { budgetMs?: number } = {},
): Promise<{ garmentTypeId: string; label: string } | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const { options } = await getCatalogOptions(app, { gender, publicOnly: true });
    const candidates: RecognitionCandidate[] = options.garmentTypes.flatMap((t) =>
      t.slug ? [{ id: t.id, slug: t.slug, label: t.label }] : [],
    );
    // Nothing this gender's types could be recognised as: straight to the list,
    // without a request no one can answer usefully.
    if (candidates.length === 0) return null;

    const requestId = randomUUID();
    const request: GarmentRecognitionRequest = {
      requestId,
      garmentKey,
      options: candidates.map(({ slug, label }) => ({ slug, label })),
      expiresAt: Date.now() + budgetMs,
    };
    await app.redis.xadd(
      GARMENT_RECOGNITION_STREAM,
      'MAXLEN',
      '~',
      String(STREAM_MAXLEN),
      '*',
      'payload',
      JSON.stringify(request),
    );

    const result = await waitForResult(app, requestId, budgetMs);
    if (!result || result.error === 'expired') {
      count('timeout');
      return null;
    }
    if (result.error) {
      count(result.error);
      return null;
    }
    const hit = matchAnswer(result.answer, candidates);
    count(hit ? 'matched' : 'unmatched');
    if (!hit) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info(
        { requestId, answer: result.answer?.slice(0, 40) },
        'garment recognition answer not in options',
      );
    }
    return hit ? { garmentTypeId: hit.id, label: hit.label } : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

export function recordRecognitionCorrected(): void {
  garmentClassifyCorrectedTotal.inc();
}

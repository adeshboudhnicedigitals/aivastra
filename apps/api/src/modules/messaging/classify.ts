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
import type { Gender } from './engine/types.js';

// Spec 8a: the most the seller waits at the photo step, before any question is
// asked; it does not overlap with the gender question.
export const RECOGNITION_BUDGET_MS = 12_000;
const POLL_MS = 200;
const GENDERS: Gender[] = ['women', 'men', 'boys', 'girls'];
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
 * surrounding whitespace, quotes and trailing punctuation are removed — and so
 * is an exact, unique label (D55: Qwen sometimes replies with the option's
 * label though the prompt asks for the key). Nothing looser: a fuzzy match
 * that picks the wrong type costs the seller a wrong generation, while no
 * match only costs them one tap on the list.
 */
export function matchAnswer(
  answer: string | null,
  candidates: RecognitionCandidate[],
): RecognitionCandidate | null {
  if (!answer) return null;
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^["'`]+/, '')
      .replace(/["'`.!]+$/, '');
  const a = normalize(answer);
  // NONE is never an option, even if some label normalized to it.
  if (a === 'none') return null;
  const slugHit = candidates.find((c) => c.slug === a);
  if (slugHit) return slugHit;
  const labelHits = candidates.filter((c) => normalize(c.label) === a);
  return labelHits.length === 1 ? (labelHits[0] as RecognitionCandidate) : null;
}

async function waitForResult(
  app: FastifyInstance,
  requestId: string,
  budgetMs: number,
): Promise<GarmentRecognitionResult | null> {
  const key = garmentRecognitionResultKey(requestId);
  const deadline = Date.now() + budgetMs;
  // Checked once even with the budget spent, so a result that landed just as
  // the budget ran out is still used.
  for (;;) {
    const raw = await app.redis.get(key);
    if (raw) {
      const parsed = GarmentRecognitionResult.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : { answer: null, error: 'failed', ms: 0 };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const norm = (s: string) => s.trim().toLowerCase();

async function publicTypes(app: FastifyInstance, gender: Gender): Promise<RecognitionCandidate[]> {
  const { options } = await getCatalogOptions(app, { gender, publicOnly: true });
  return options.garmentTypes.flatMap((t) =>
    t.slug ? [{ id: t.id, slug: t.slug, label: t.label }] : [],
  );
}

/**
 * What the model chooses among: one option per label across every gender, so
 * the prompt grows by the genuinely different kinds only, never by "Shirt"
 * four times. Types are per-gender rows, and a photo carries no gender, so the
 * answer is a kind; typeForKind maps it to the tapped gender's row.
 */
async function kindCandidates(app: FastifyInstance): Promise<RecognitionCandidate[]> {
  const byLabel = new Map<string, RecognitionCandidate>();
  for (const gender of GENDERS) {
    for (const c of await publicTypes(app, gender)) {
      if (!byLabel.has(norm(c.label))) byLabel.set(norm(c.label), c);
    }
  }
  return [...byLabel.values()];
}

/**
 * Spec 2026-10-22: asked the moment the photo arrives. Queues one request over
 * every gender's public-slug kinds (one option per label), waits up to the
 * budget and returns the recognised kind's label — a kind, not a row, because
 * the photo carries no gender (typeForKind maps it once the seller has tapped
 * one). Null for every failure; the list is then the way out, so recognition
 * can cost a tap but never a run.
 */
export async function recognizeKind(
  app: FastifyInstance,
  garmentKey: string,
  opts: { budgetMs?: number } = {},
): Promise<{ label: string } | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const candidates = await kindCandidates(app);
    // Nothing a photo could be recognised as: straight to the list, without a
    // request no one can answer usefully.
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
    const kind = matchAnswer(result.answer, candidates);
    count(kind ? 'matched' : 'unmatched');
    if (!kind) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info(
        { requestId, answer: result.answer?.slice(0, 40) },
        'garment recognition answer not in options',
      );
    }
    return kind ? { label: kind.label } : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

/**
 * The recognised kind as the tapped gender's own type (types are per-gender
 * rows). Null when that gender has no type of that kind: the seller then picks
 * from the list.
 */
export async function typeForKind(
  app: FastifyInstance,
  label: string,
  gender: Gender,
): Promise<{ garmentTypeId: string; label: string } | null> {
  try {
    const own = (await publicTypes(app, gender)).find((c) => norm(c.label) === norm(label));
    if (!own) app.log.info({ label, gender }, 'garment kind has no type for this gender');
    return own ? { garmentTypeId: own.id, label: own.label } : null;
  } catch (err) {
    app.log.warn({ err }, 'garment kind could not be mapped; falling back to the list');
    return null;
  }
}

export function recordRecognitionCorrected(): void {
  garmentClassifyCorrectedTotal.inc();
}

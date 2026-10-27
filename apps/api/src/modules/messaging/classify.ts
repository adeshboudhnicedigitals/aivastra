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
import {
  type BasketChoice,
  basketChoices,
  basketMembers,
  loadBasketTypes,
  type RankedBasket,
  rankBaskets,
} from './baskets.js';
import type { Gender } from './engine/types.js';

// Spec 8a: the most the seller waits after tapping the gender, before the
// basket guess (or the list) is shown.
export const RECOGNITION_BUDGET_MS = 12_000;
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

/**
 * Below this, the top basket is not offered as a guess and the seller picks
 * from the list. A placeholder until it is set from real seller photos: the
 * Requests tab (garment_recognitions.ranked) and the "No, different item"
 * counter are the data to tune it with (handoff section 8).
 */
export const MIN_BASKET_SCORE = 0.5;
// The guess plus this many alternatives behind "No, different item".
export const MAX_BASKETS = 4;

/**
 * Handoff 2026-10-26: asked once the gender is known. Sends the classifier
 * every single-image type of that gender with a public slug, sums the
 * per-type probabilities per basket and returns the baskets best first (the
 * guess, then alternatives). Null for every failure, and when the top basket
 * is weaker than MIN_BASKET_SCORE: the type list is then the way out, so
 * recognition can cost a tap but never a run.
 *
 * A backend that cannot rank (the ComfyUI path, the plain service) answers
 * with one slug; that is taken as certain, which is what the bot did before
 * baskets.
 */
export async function recognizeBaskets(
  app: FastifyInstance,
  garmentKey: string,
  gender: Gender,
  opts: { budgetMs?: number } = {},
): Promise<RankedBasket[] | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const { types, baskets } = await loadBasketTypes(app, gender);
    const candidates: RecognitionCandidate[] = types.flatMap((t) =>
      t.slug ? [{ id: t.id, slug: t.slug, label: t.label }] : [],
    );
    // Nothing a photo could be recognised as: straight to the list, without a
    // request no one can answer usefully.
    if (candidates.length === 0) return null;
    const requestId = randomUUID();
    const request: GarmentRecognitionRequest = {
      requestId,
      garmentKey,
      options: candidates.map(({ slug, label }) => ({ slug, label })),
      expiresAt: Date.now() + budgetMs,
      gender,
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
    const single = result.ranked ? null : matchAnswer(result.answer, candidates);
    const ranked = rankBaskets(
      result.ranked ?? (single ? [{ slug: single.slug, p: 1 }] : []),
      types,
      baskets,
    ).slice(0, MAX_BASKETS);
    const top = ranked[0];
    const confident = top !== undefined && top.score >= MIN_BASKET_SCORE;
    count(confident ? 'matched' : 'unmatched');
    if (!confident) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info(
        { requestId, answer: result.answer?.slice(0, 40), topScore: top?.score ?? null },
        'garment recognition not confident enough; showing the list',
      );
    }
    return confident ? ranked : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

/** The types a basket stands for, representative first (baskets.ts basketMembers). */
export async function typesOfBasket(
  app: FastifyInstance,
  gender: Gender,
  key: string,
): Promise<{ id: string; label: string }[]> {
  const { types, baskets } = await loadBasketTypes(app, gender);
  return basketMembers(key, types, baskets);
}

export function recordRecognitionCorrected(): void {
  garmentClassifyCorrectedTotal.inc();
}

/** The fallback pick list (baskets.ts basketChoices); `offered` is the bot's type ids. */
export async function listBaskets(
  app: FastifyInstance,
  gender: Gender,
  offered: Set<string>,
): Promise<BasketChoice[]> {
  const { types, baskets } = await loadBasketTypes(app, gender);
  return basketChoices(types, baskets, offered);
}

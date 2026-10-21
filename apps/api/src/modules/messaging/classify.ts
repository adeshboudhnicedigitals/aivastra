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
import type { Gender, RecognitionTicket } from './engine/types.js';

// Spec 8a: counted from the photo upload; whatever the gender question leaves
// of it is the most the seller waits after the gender tap.
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
  // Checked once even with the budget spent: the gender answer may have taken
  // longer than the dispatcher.
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
 * answer is a kind; resolveRecognition maps it to the tapped gender's row.
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
 * Spec 8a, first half: sent the moment the photo arrives, before the gender
 * question, so the dispatcher works while the seller answers it. Only queues
 * the request. Null when recognition is off or there is nothing to recognise
 * (the bot then shows the list); never throws.
 */
export async function startRecognition(
  app: FastifyInstance,
  garmentKey: string,
  opts: { budgetMs?: number } = {},
): Promise<RecognitionTicket | null> {
  if (app.env.GARMENT_RECOGNITION_ENABLED !== true) return null;
  const budgetMs = opts.budgetMs ?? RECOGNITION_BUDGET_MS;
  try {
    const candidates = await kindCandidates(app);
    // Nothing a photo could be recognised as: straight to the list, without a
    // request no one can answer usefully.
    if (candidates.length === 0) return null;
    const requestId = randomUUID();
    const expiresAt = Date.now() + budgetMs;
    const request: GarmentRecognitionRequest = {
      requestId,
      garmentKey,
      options: candidates.map(({ slug, label }) => ({ slug, label })),
      expiresAt,
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
    return { requestId, expiresAt };
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition not started; falling back to the list');
    return null;
  }
}

/**
 * Spec 8a, second half: waits out what is left of the budget (the seller's
 * gender answer already used part of it) and maps the recognised kind to the
 * tapped gender's own type. Null for every failure, and for a kind that gender
 * does not have — the list is then the way out, so recognition can cost a tap
 * but never a run.
 */
export async function resolveRecognition(
  app: FastifyInstance,
  ticket: RecognitionTicket,
  gender: Gender,
): Promise<{ garmentTypeId: string; label: string } | null> {
  try {
    const result = await waitForResult(app, ticket.requestId, ticket.expiresAt - Date.now());
    if (!result || result.error === 'expired') {
      count('timeout');
      return null;
    }
    if (result.error) {
      count(result.error);
      return null;
    }
    const kind = matchAnswer(result.answer, await kindCandidates(app));
    const own = kind
      ? (await publicTypes(app, gender)).find((c) => norm(c.label) === norm(kind.label))
      : undefined;
    count(own ? 'matched' : 'unmatched');
    if (!kind) {
      // The raw answer is model output about a garment photo, not personal data;
      // capped so a runaway answer cannot flood the log.
      app.log.info(
        { requestId: ticket.requestId, answer: result.answer?.slice(0, 40) },
        'garment recognition answer not in options',
      );
    }
    return own ? { garmentTypeId: own.id, label: own.label } : null;
  } catch (err) {
    count('failed');
    app.log.warn({ err }, 'garment recognition failed; falling back to the list');
    return null;
  }
}

export function recordRecognitionCorrected(): void {
  garmentClassifyCorrectedTotal.inc();
}

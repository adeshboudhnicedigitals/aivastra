import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';

export interface RecognitionRecord {
  // The GarmentRecognitionRequest id.
  id: string;
  gender: string | null;
  garmentKey: string;
  // The exact options sent to the model, so admin shows what it chose from.
  options: Array<{ slug: string; label: string }>;
  // The model's raw text (null when there is no answer to record).
  answer: string | null;
  // Every option's probability, best first; null when the backend cannot rank.
  ranked: Array<{ slug: string; p: number }> | null;
  outcome: 'answered' | 'no_worker' | 'failed' | 'expired';
  ms: number;
  workerId: string | null;
  workflowTemplateId: string | null;
}

/**
 * One garment_recognitions row per request (D54). Best effort: catches and
 * logs every error (pino, no secrets) and never throws, so a failed insert
 * can never change the answer the lane returns.
 */
export async function recordRecognition(
  db: DB,
  row: RecognitionRecord,
  log: Logger,
): Promise<void> {
  try {
    await db.insert(schema.garmentRecognitions).values({
      id: row.id,
      gender: row.gender,
      garmentKey: row.garmentKey,
      options: row.options,
      answer: row.answer,
      ranked: row.ranked,
      outcome: row.outcome,
      ms: row.ms,
      workerId: row.workerId,
      workflowTemplateId: row.workflowTemplateId,
    });
  } catch (err) {
    log.warn({ err, requestId: row.id }, 'could not record garment recognition');
  }
}

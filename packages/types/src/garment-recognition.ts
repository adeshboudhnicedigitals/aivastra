import { z } from 'zod';

// The api ↔ dispatcher contract for garment recognition (WhatsApp bot spec,
// section 8a). The api never talks to a GPU worker: it appends a request to
// this stream and polls the result key; the dispatcher runs the classify-only
// ComfyUI workflow and writes the answer.
export const GARMENT_RECOGNITION_STREAM = 'classify:requests';
export const garmentRecognitionResultKey = (requestId: string) => `classify:result:${requestId}`;
// Long enough to inspect after the fact; the bot itself stops waiting after 8 s.
export const GARMENT_RECOGNITION_RESULT_TTL_SEC = 3600;

export const GarmentRecognitionRequest = z.object({
  requestId: z.string().uuid(),
  garmentKey: z.string().min(1),
  // That gender's garment types with a public_api_slug; the model must answer
  // with exactly one slug (or NONE).
  options: z.array(z.object({ slug: z.string().min(1), label: z.string().min(1) })).min(1),
  // Epoch ms. A request picked up after this is skipped with error 'expired':
  // the seller has had the garment-type list since then, so GPU time is wasted.
  expiresAt: z.number().int(),
});
export type GarmentRecognitionRequest = z.infer<typeof GarmentRecognitionRequest>;

export const GarmentRecognitionResult = z.object({
  // The model's raw text. The api decides whether it matches an option, so the
  // matching rule lives in one place (apps/api/src/modules/messaging/classify.ts).
  answer: z.string().nullable(),
  error: z.enum(['no_worker', 'failed', 'expired']).nullable(),
  // Pick-up to answer, as measured by the dispatcher.
  ms: z.number().int().nonnegative(),
});
export type GarmentRecognitionResult = z.infer<typeof GarmentRecognitionResult>;

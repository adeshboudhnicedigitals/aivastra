import { z } from 'zod';

// WhatsApp conversation trace (admin debug view): what the bot received and sent,
// per seller number, kept in Redis for a few days. See
// apps/api/src/modules/messaging/trace.ts.

export const TraceOption = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
});
export type TraceOption = z.infer<typeof TraceOption>;

const TraceIn = z.object({
  dir: z.literal('in'),
  t: z.number(),
  kind: z.enum(['text', 'reply', 'image', 'unsupported']),
  text: z.string().optional(),
  // A tap, decoded from the reply id (the prompt nonce is not kept).
  action: z.string().optional(),
  value: z.string().optional(),
});

const TraceOut = z.object({
  dir: z.literal('out'),
  t: z.number(),
  kind: z.enum(['text', 'buttons', 'list', 'cards', 'link']),
  text: z.string(),
  buttonLabel: z.string().optional(),
  // Buttons, list rows or cards, whichever the message carried.
  options: z.array(TraceOption).optional(),
  url: z.string().optional(),
  status: z.enum(['sent', 'failed', 'skipped']),
  error: z.string().optional(),
});

export const TraceEntry = z.discriminatedUnion('dir', [TraceIn, TraceOut]);
export type TraceEntry = z.infer<typeof TraceEntry>;

export const TraceSender = z.object({
  // wa_id digits, as Meta sends them (no '+').
  waId: z.string(),
  lastAt: z.number(),
  count: z.number().int(),
  preview: z.string(),
});
export type TraceSender = z.infer<typeof TraceSender>;

export const TraceSendersResponse = z.object({ items: z.array(TraceSender) });
export const TraceTimelineResponse = z.object({ entries: z.array(TraceEntry) });

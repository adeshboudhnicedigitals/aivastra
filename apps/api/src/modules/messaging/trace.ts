import type { TraceEntry, TraceSender } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import type { InboundContent } from './channels/whatsapp/parse.js';
import { decodeReplyId } from './engine/reply-id.js';
import type { OutboundMessage } from './engine/types.js';

// Admin debug view of the WhatsApp conversation (admin Conversations tab): what
// the bot received and sent, per seller, for a few days. Keyed by wa_id digits
// as Meta sends them, so inbound (ParsedInbound.from) and outbound (the `to` of
// sendMessages) land in the same list. Best effort throughout: a Redis problem
// is logged and never reaches the conversation.

export const TRACE_TTL_SECONDS = 4 * 24 * 60 * 60;
export const TRACE_MAX_ENTRIES = 300;
const INDEX_KEY = 'wa:trace:index';
const ERROR_MAX = 200;
const NOTE_TITLE_MAX = 160;
const NOTE_LINES_MAX = 12;
const NOTE_LINE_MAX = 300;

const listKey = (waId: string) => `wa:trace:${waId}`;

async function push(app: FastifyInstance, waId: string, entry: TraceEntry): Promise<void> {
  try {
    const key = listKey(waId);
    await app.redis
      .multi()
      .rpush(key, JSON.stringify(entry))
      .ltrim(key, -TRACE_MAX_ENTRIES, -1)
      .expire(key, TRACE_TTL_SECONDS)
      .zadd(INDEX_KEY, entry.t, waId)
      .expire(INDEX_KEY, TRACE_TTL_SECONDS)
      .exec();
  } catch (err) {
    app.log.warn({ err }, 'whatsapp trace write failed');
  }
}

export async function traceInbound(
  app: FastifyInstance,
  waId: string,
  content: InboundContent,
): Promise<void> {
  const t = Date.now();
  switch (content.kind) {
    case 'text':
      return push(app, waId, { dir: 'in', t, kind: 'text', text: content.text });
    case 'reply': {
      const d = decodeReplyId(content.id);
      return push(app, waId, {
        dir: 'in',
        t,
        kind: 'reply',
        action: d?.action ?? 'unknown',
        value: d?.value ?? content.id,
      });
    }
    case 'templateButton':
      return push(app, waId, {
        dir: 'in',
        t,
        kind: 'reply',
        action: 'template',
        value: content.payload,
      });
    case 'image':
      return push(app, waId, { dir: 'in', t, kind: 'image' });
    default:
      return push(app, waId, { dir: 'in', t, kind: 'unsupported' });
  }
}

export async function traceOutbound(
  app: FastifyInstance,
  waId: string,
  message: OutboundMessage,
  status: 'sent' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  const base = {
    dir: 'out' as const,
    t: Date.now(),
    status,
    ...(error ? { error: error.slice(0, ERROR_MAX) } : {}),
  };
  switch (message.kind) {
    case 'text':
      return push(app, waId, { ...base, kind: 'text', text: message.text });
    case 'buttons':
      return push(app, waId, {
        ...base,
        kind: 'buttons',
        text: message.text,
        options: message.buttons.map((b) => ({ id: b.id, title: b.title })),
      });
    case 'list':
      return push(app, waId, {
        ...base,
        kind: 'list',
        text: message.text,
        buttonLabel: message.buttonLabel,
        options: message.rows,
      });
    case 'cards':
      return push(app, waId, {
        ...base,
        kind: 'cards',
        text: message.text,
        options: message.cards.map((c) => ({ id: c.id, title: 'card' })),
      });
    case 'link':
      return push(app, waId, {
        ...base,
        kind: 'link',
        text: message.text,
        buttonLabel: message.label,
        url: message.url,
      });
  }
}

/** A decision the bot made and why (see TraceNote); shown between the messages. */
export async function traceNote(
  app: FastifyInstance,
  waId: string,
  title: string,
  lines: string[],
): Promise<void> {
  return push(app, waId, {
    dir: 'note',
    t: Date.now(),
    title: title.slice(0, NOTE_TITLE_MAX),
    lines: lines.slice(0, NOTE_LINES_MAX).map((l) => l.slice(0, NOTE_LINE_MAX)),
  });
}

const previewOf = (e: TraceEntry | undefined): string => {
  if (!e) return '';
  if (e.dir === 'note') return e.title;
  if (e.dir === 'out') return e.text;
  if (e.kind === 'text') return e.text ?? '';
  if (e.kind === 'reply') return `tapped ${e.action}${e.value ? `: ${e.value}` : ''}`;
  return e.kind === 'image' ? '[photo]' : '[unsupported]';
};

/** Senders with a live trace, most recent activity first. */
export async function listSenders(app: FastifyInstance): Promise<TraceSender[]> {
  const cutoff = Date.now() - TRACE_TTL_SECONDS * 1000;
  await app.redis.zremrangebyscore(INDEX_KEY, '-inf', cutoff);
  const ranked = await app.redis.zrevrange(INDEX_KEY, 0, -1, 'WITHSCORES');
  const out: TraceSender[] = [];
  for (let i = 0; i < ranked.length; i += 2) {
    const waId = ranked[i];
    const lastRaw = await app.redis.lindex(listKey(waId), -1);
    if (!lastRaw) continue; // the list expired before the index entry
    out.push({
      waId,
      lastAt: Number(ranked[i + 1]),
      count: await app.redis.llen(listKey(waId)),
      preview: previewOf(JSON.parse(lastRaw) as TraceEntry).slice(0, 120),
    });
  }
  return out;
}

/** One sender's entries, oldest first. */
export async function readTimeline(app: FastifyInstance, waId: string): Promise<TraceEntry[]> {
  const raw = await app.redis.lrange(listKey(waId), 0, -1);
  return raw.map((r) => JSON.parse(r) as TraceEntry);
}

import { decodeReplyId } from '../../engine/reply-id.js';

export type InboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'reply'; id: string }
  | { kind: 'image'; mediaId: string; mimeType: string }
  // A tap on the results template's quick-reply button (D26).
  | { kind: 'templateButton'; payload: string }
  | { kind: 'unsupported' };

export interface ParsedInbound {
  messageId: string;
  // wa_id: E.164 digits without '+'.
  from: string;
  profileName: string | null;
  content: InboundContent;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function content(m: Obj): InboundContent {
  switch (m.type) {
    case 'text': {
      const body = str(obj(m.text)?.body);
      return body !== undefined ? { kind: 'text', text: body } : { kind: 'unsupported' };
    }
    case 'image': {
      const img = obj(m.image);
      const id = str(img?.id);
      return id
        ? { kind: 'image', mediaId: id, mimeType: str(img?.mime_type) ?? '' }
        : { kind: 'unsupported' };
    }
    case 'interactive': {
      const i = obj(m.interactive);
      // button_reply / list_reply are documented; quick_reply is kept as a
      // harmless extra — the spike showed carousel taps arrive as type
      // 'button', never as interactive.quick_reply.
      const id =
        str(obj(i?.button_reply)?.id) ??
        str(obj(i?.list_reply)?.id) ??
        str(obj(i?.quick_reply)?.id);
      return id ? { kind: 'reply', id } : { kind: 'unsupported' };
    }
    case 'button': {
      const payload = str(obj(m.button)?.payload);
      if (!payload) return { kind: 'unsupported' };
      // Spike 2026-10-13 (source of truth): carousel quick-reply taps arrive
      // as type 'button' with the engine reply id in payload — without this
      // check, pose picks would read as template taps ("Show images").
      return decodeReplyId(payload) !== null
        ? { kind: 'reply', id: payload }
        : { kind: 'templateButton', payload };
    }
    default:
      return { kind: 'unsupported' };
  }
}

export interface ParsedStatus {
  // The wamid of a message we sent.
  messageId: string;
  // sent | delivered | read | failed
  status: string;
}

/** Delivery receipts for messages we sent. Defensive like parseWebhook: untrusted input. */
export function parseStatuses(body: unknown): ParsedStatus[] {
  const out: ParsedStatus[] = [];
  for (const entry of arr(obj(body)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (c?.field !== 'messages') continue;
      for (const raw of arr(obj(c.value)?.statuses)) {
        const st = obj(raw);
        const id = str(st?.id);
        const status = str(st?.status);
        if (id && status) out.push({ messageId: id, status });
      }
    }
  }
  return out;
}

/** Defensive by design: the body is untrusted input even after the signature check. */
export function parseWebhook(body: unknown): ParsedInbound[] {
  const out: ParsedInbound[] = [];
  for (const entry of arr(obj(body)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (c?.field !== 'messages') continue;
      const value = obj(c.value);
      const names = new Map<string, string>();
      for (const contact of arr(value?.contacts)) {
        const k = obj(contact);
        const waId = str(k?.wa_id);
        const name = str(obj(k?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }
      for (const raw of arr(value?.messages)) {
        const m = obj(raw);
        const id = str(m?.id);
        const from = str(m?.from);
        if (!m || !id || !from) continue;
        out.push({
          messageId: id,
          from,
          profileName: names.get(from) ?? null,
          content: content(m),
        });
      }
    }
  }
  return out;
}

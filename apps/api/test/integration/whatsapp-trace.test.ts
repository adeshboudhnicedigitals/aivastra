import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import {
  listSenders,
  readTimeline,
  TRACE_MAX_ENTRIES,
  TRACE_TTL_SECONDS,
  traceInbound,
  traceOutbound,
} from '../../src/modules/messaging/trace';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

let seq = 0;
const waId = () => `9188${Date.now().toString().slice(-6)}${(++seq).toString().padStart(2, '0')}`;

describe('whatsapp trace recorder', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('keeps entries in order, decodes taps, and keeps list options', async () => {
    const id = waId();
    await traceInbound(app, id, { kind: 'text', text: 'hello' });
    await traceOutbound(
      app,
      id,
      {
        kind: 'list',
        text: 'Which garment is it?',
        buttonLabel: 'Choose',
        rows: [
          { id: 'n1|basket|b:tops', title: 'Tops' },
          { id: 'n1|basket|b:lowers', title: 'Lowers', description: 'pants' },
        ],
      },
      'sent',
    );
    await traceInbound(app, id, { kind: 'reply', id: encodeReplyId('n1', 'basket', 'b:tops') });

    const t = await readTimeline(app, id);
    expect(t.map((e) => e.dir)).toEqual(['in', 'out', 'in']);
    expect(t[0]).toMatchObject({ kind: 'text', text: 'hello' });
    expect(t[1]).toMatchObject({
      kind: 'list',
      status: 'sent',
      buttonLabel: 'Choose',
      options: [
        { id: 'n1|basket|b:tops', title: 'Tops' },
        { id: 'n1|basket|b:lowers', title: 'Lowers', description: 'pants' },
      ],
    });
    expect(t[2]).toMatchObject({ kind: 'reply', action: 'basket', value: 'b:tops' });
  });

  it('records failed and skipped sends with the error', async () => {
    const id = waId();
    await traceOutbound(app, id, { kind: 'text', text: 'x' }, 'failed', 'Meta 131000: boom');
    await traceOutbound(app, id, { kind: 'text', text: 'y' }, 'skipped');
    const t = await readTimeline(app, id);
    expect(t[0]).toMatchObject({ status: 'failed', error: 'Meta 131000: boom' });
    expect(t[1]).toMatchObject({ status: 'skipped' });
  });

  it('caps the list and sets a 4-day TTL', async () => {
    const id = waId();
    for (let i = 0; i < TRACE_MAX_ENTRIES + 5; i++) {
      await traceInbound(app, id, { kind: 'text', text: `m${i}` });
    }
    const t = await readTimeline(app, id);
    expect(t).toHaveLength(TRACE_MAX_ENTRIES);
    expect(t[0]).toMatchObject({ text: 'm5' });
    const ttl = await app.redis.ttl(`wa:trace:${id}`);
    expect(ttl).toBeGreaterThan(TRACE_TTL_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(TRACE_TTL_SECONDS);
  });

  it('lists senders most recent first with count and preview', async () => {
    const a = waId();
    const b = waId();
    await traceInbound(app, a, { kind: 'text', text: 'first sender' });
    await new Promise((r) => setTimeout(r, 5));
    await traceOutbound(app, b, { kind: 'text', text: 'second sender last msg' }, 'sent');
    const senders = await listSenders(app);
    const ia = senders.findIndex((s) => s.waId === a);
    const ib = senders.findIndex((s) => s.waId === b);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ib).toBeLessThan(ia);
    expect(senders[ib]).toMatchObject({ count: 1, preview: 'second sender last msg' });
  });

  it('drops senders whose last activity is older than the TTL', async () => {
    const id = waId();
    await traceInbound(app, id, { kind: 'text', text: 'old' });
    await app.redis.zadd('wa:trace:index', Date.now() - (TRACE_TTL_SECONDS + 10) * 1000, id);
    const senders = await listSenders(app);
    expect(senders.find((s) => s.waId === id)).toBeUndefined();
  });

  it('never throws when Redis fails', async () => {
    const id = waId();
    const real = app.redis.multi.bind(app.redis);
    app.redis.multi = (() => {
      throw new Error('redis down');
    }) as typeof app.redis.multi;
    try {
      await expect(traceInbound(app, id, { kind: 'text', text: 'x' })).resolves.toBeUndefined();
      await expect(
        traceOutbound(app, id, { kind: 'text', text: 'x' }, 'sent'),
      ).resolves.toBeUndefined();
    } finally {
      app.redis.multi = real;
    }
  });
});

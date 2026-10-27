import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseStatuses, parseWebhook } from '../src/modules/messaging/channels/whatsapp/parse';
import { verifySignature } from '../src/modules/messaging/channels/whatsapp/signature';

const wrap = (messages: unknown[], contacts: unknown[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        { field: 'messages', value: { messaging_product: 'whatsapp', contacts, messages } },
      ],
    },
  ],
});

describe('parseWebhook', () => {
  it('parses text with the sender profile name', () => {
    const out = parseWebhook(
      wrap(
        [{ from: '919100000001', id: 'wamid.1', type: 'text', text: { body: 'hi' } }],
        [{ wa_id: '919100000001', profile: { name: 'Asha' } }],
      ),
    );
    expect(out).toEqual([
      {
        messageId: 'wamid.1',
        from: '919100000001',
        profileName: 'Asha',
        content: { kind: 'text', text: 'hi' },
      },
    ]);
  });

  it('parses button, list and carousel quick-reply taps as replies', () => {
    const out = parseWebhook(
      wrap([
        {
          from: '91',
          id: 'a',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'n|x|1', title: 'X' } },
        },
        {
          from: '91',
          id: 'b',
          type: 'interactive',
          interactive: { type: 'list_reply', list_reply: { id: 'n|y|2', title: 'Y' } },
        },
        {
          from: '91',
          id: 'c',
          type: 'interactive',
          interactive: { type: 'quick_reply', quick_reply: { id: 'n|z|3' } },
        },
      ]),
    );
    expect(out.map((m) => m.content)).toEqual([
      { kind: 'reply', id: 'n|x|1' },
      { kind: 'reply', id: 'n|y|2' },
      { kind: 'reply', id: 'n|z|3' },
    ]);
  });

  it('parses a carousel tap (type button with a reply id payload) as a reply', () => {
    // Spike 2026-10-13: Meta sends carousel quick-reply taps as type 'button'
    // with the reply id in button.payload, not as interactive.quick_reply.
    const out = parseWebhook(
      wrap([
        {
          from: '91',
          id: 'c',
          type: 'button',
          button: { payload: 'n1|look|a', text: 'Select' },
          context: { from: '15556585373', id: 'wamid.x' },
        },
      ]),
    );
    expect(out.map((m) => m.content)).toEqual([{ kind: 'reply', id: 'n1|look|a' }]);
  });

  it('parses images, template buttons and flags everything else as unsupported', () => {
    const out = parseWebhook(
      wrap([
        { from: '91', id: 'i', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } },
        {
          from: '91',
          id: 't',
          type: 'button',
          button: { payload: 'SHOW_IMAGES', text: 'Show images' },
        },
        { from: '91', id: 'v', type: 'video', video: { id: 'm2' } },
      ]),
    );
    expect(out.map((m) => m.content)).toEqual([
      { kind: 'image', mediaId: 'media-1', mimeType: 'image/jpeg' },
      { kind: 'templateButton', payload: 'SHOW_IMAGES' },
      { kind: 'unsupported' },
    ]);
  });

  it('ignores status updates and junk', () => {
    expect(
      parseWebhook({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{}] } }] }] }),
    ).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: 'nope' })).toEqual([]);
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}');
  const good = `sha256=${createHmac('sha256', 'app-secret-0123456789').update(body).digest('hex')}`;
  it('accepts the right signature', () => {
    expect(verifySignature(body, good, 'app-secret-0123456789')).toBe(true);
  });
  it('rejects a wrong, missing or malformed one', () => {
    expect(verifySignature(body, good, 'other-secret-0123456789')).toBe(false);
    expect(verifySignature(body, undefined, 'app-secret-0123456789')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 'app-secret-0123456789')).toBe(false);
  });
});

describe('parseStatuses', () => {
  const statuses = (list: unknown[]) => ({
    entry: [{ changes: [{ field: 'messages', value: { statuses: list } }] }],
  });

  it('reads the receipt for each message we sent', () => {
    expect(
      parseStatuses(
        statuses([
          { id: 'wamid.a', status: 'sent', recipient_id: '919100000001' },
          { id: 'wamid.a', status: 'delivered' },
          { id: 'wamid.b', status: 'failed' },
        ]),
      ),
    ).toEqual([
      { messageId: 'wamid.a', status: 'sent' },
      { messageId: 'wamid.a', status: 'delivered' },
      { messageId: 'wamid.b', status: 'failed' },
    ]);
  });

  it('skips entries without an id or status, other fields, and malformed bodies', () => {
    expect(
      parseStatuses(statuses([{ status: 'delivered' }, { id: 'wamid.a' }, 'x', null])),
    ).toEqual([]);
    expect(
      parseStatuses({
        entry: [
          { changes: [{ field: 'other', value: { statuses: [{ id: 'a', status: 'sent' }] } }] },
        ],
      }),
    ).toEqual([]);
    expect(parseStatuses(null)).toEqual([]);
    expect(parseStatuses({ entry: 'nope' })).toEqual([]);
  });

  it('a body with only statuses carries no inbound messages', () => {
    expect(parseWebhook(statuses([{ id: 'wamid.a', status: 'delivered' }]))).toEqual([]);
  });
});

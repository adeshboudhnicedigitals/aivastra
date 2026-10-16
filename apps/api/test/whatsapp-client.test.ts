import { describe, expect, it, vi } from 'vitest';
import {
  createWhatsappClient,
  MetaApiError,
} from '../src/modules/messaging/channels/whatsapp/client';

const cfg = {
  phoneNumberId: '111',
  accessToken: 'tok-0123456789abcdefghij',
  graphVersion: 'v25.0',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('whatsapp client', () => {
  it('sends with the bearer token and returns the message id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { messages: [{ id: 'wamid.1' }] }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    await expect(c.send('919100000001', { type: 'text', text: { body: 'hi' } })).resolves.toEqual({
      messageId: 'wamid.1',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/111/messages');
    expect(init.headers.Authorization).toBe('Bearer tok-0123456789abcdefghij');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919100000001',
      type: 'text',
      text: { body: 'hi' },
    });
  });

  it('surfaces Meta error codes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json(400, { error: { message: 'Re-engagement message', code: 131047 } }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    const err = await c.send('9191', { type: 'text', text: { body: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ status: 400, code: 131047 });
  });

  it('downloads media in two steps and refuses oversize files', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { url: 'https://lookaside/x', mime_type: 'image/jpeg', file_size: 3 }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    const media = await c.downloadMedia('m1', 10);
    expect(media.mimeType).toBe('image/jpeg');
    expect([...media.bytes]).toEqual([1, 2, 3]);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer tok-0123456789abcdefghij',
    );

    const big = vi
      .fn()
      .mockResolvedValueOnce(json(200, { url: 'u', mime_type: 'image/jpeg', file_size: 11 }));
    await expect(
      createWhatsappClient({ ...cfg, fetchImpl: big }).downloadMedia('m2', 10),
    ).rejects.toThrow(/too large/);
  });

  it('uploads media and returns its id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { id: 'media-1' }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    await expect(c.uploadMedia(Buffer.from('png'), 'image/png')).resolves.toBe('media-1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/111/media');
    expect(init.body).toBeInstanceOf(FormData);
  });
});

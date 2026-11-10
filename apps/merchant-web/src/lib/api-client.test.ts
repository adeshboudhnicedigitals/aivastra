import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initToken } from './api';
import { api } from './api-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  initToken('tok');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('get sends the Bearer token and returns parsed JSON', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ items: [1] }));
    vi.stubGlobal('fetch', f);
    await expect(api.get<{ items: number[] }>('/v1/merchant/catalog')).resolves.toEqual({
      items: [1],
    });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/merchant\/catalog$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('post and patch send JSON bodies with the right method', async () => {
    const f = vi.fn().mockImplementation(async () => json({ ok: true }));
    vi.stubGlobal('fetch', f);
    await api.post('/v1/x', { a: 1 });
    await api.patch('/v1/x/1', { b: 2 });
    const [, post] = f.mock.calls[0] as [string, RequestInit];
    const [, patch] = f.mock.calls[1] as [string, RequestInit];
    expect(post.method).toBe('POST');
    expect(post.body).toBe(JSON.stringify({ a: 1 }));
    expect((post.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(patch.method).toBe('PATCH');
    expect(patch.body).toBe(JSON.stringify({ b: 2 }));
  });

  it('del resolves undefined on 204', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    await expect(api.del<void>('/v1/x/1')).resolves.toBeUndefined();
    expect((f.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('uploadToR2 PUTs the file with its content type and no Authorization header', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const file = new File(['abc'], 'a.png', { type: 'image/png' });
    await api.uploadToR2('https://r2.example/put', file);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://r2.example/put');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(file);
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(init.credentials).not.toBe('include');
  });

  it('uploadToR2 throws a readable error on a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 413 })));
    const file = new File(['abc'], 'a.png', { type: 'image/png' });
    await expect(api.uploadToR2('https://r2.example/put', file)).rejects.toThrow(
      'The selected file is too large.',
    );
  });

  it('uploadToR2 throws a readable error when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('x')));
    const file = new File(['abc'], 'a.png', { type: 'image/png' });
    await expect(api.uploadToR2('https://r2.example/put', file)).rejects.toThrow(
      'Unable to upload the file. Check your connection and try again.',
    );
  });
});

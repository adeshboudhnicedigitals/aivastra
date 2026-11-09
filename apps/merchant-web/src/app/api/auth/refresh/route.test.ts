import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/refresh', () => {
  it('401s without an mw_refresh cookie', async () => {
    const res = await POST(
      new NextRequest('http://localhost:3010/api/auth/refresh', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('forwards the cookie as refresh and re-sets the rotated one', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'new' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'refresh=rt2; Path=/' },
      }),
    );
    vi.stubGlobal('fetch', f);
    const res = await POST(
      new NextRequest('http://localhost:3010/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'mw_refresh=rt1' },
      }),
    );
    expect(res.status).toBe(200);
    expect(f.mock.calls[0]?.[1].headers.Cookie).toBe('refresh=rt1');
    expect(res.headers.get('set-cookie')).toContain('mw_refresh=rt2');
  });

  it('forwards cf-connecting-ip only when the visitor request has it', async () => {
    const f = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ accessToken: 'new' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', f);
    await POST(
      new NextRequest('http://localhost:3010/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'mw_refresh=rt1', 'cf-connecting-ip': '203.0.113.7' },
      }),
    );
    expect(f.mock.calls[0]?.[1].headers['cf-connecting-ip']).toBe('203.0.113.7');
    await POST(
      new NextRequest('http://localhost:3010/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'mw_refresh=rt1' },
      }),
    );
    expect(f.mock.calls[1]?.[1].headers).not.toHaveProperty('cf-connecting-ip');
  });
});

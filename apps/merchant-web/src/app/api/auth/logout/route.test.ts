import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

afterEach(() => vi.unstubAllGlobals());

function logoutReq(headers: Record<string, string>) {
  return new NextRequest('http://localhost:3010/api/auth/logout', { method: 'POST', headers });
}

describe('POST /api/auth/logout', () => {
  it('forwards cf-connecting-ip only when the visitor request has it', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await POST(logoutReq({ cookie: 'mw_refresh=rt1', 'cf-connecting-ip': '203.0.113.7' }));
    expect(f.mock.calls[0]?.[1].headers['cf-connecting-ip']).toBe('203.0.113.7');
    await POST(logoutReq({ cookie: 'mw_refresh=rt1' }));
    expect(f.mock.calls[1]?.[1].headers).not.toHaveProperty('cf-connecting-ip');
  });
});

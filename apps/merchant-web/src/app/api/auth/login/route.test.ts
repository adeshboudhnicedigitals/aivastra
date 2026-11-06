import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ME = {
  merchantId: 'm1',
  role: 'admin',
  branchId: null,
  staffId: null,
  companyName: 'Acme',
  staffLimitPerBranch: 3,
  deviceQuotaPerMonth: null,
};

function loginReq() {
  return new NextRequest('http://localhost:3010/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.co', password: 'pw' }),
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const loginOk = () =>
  json({ accessToken: 'tok' }, 200, { 'set-cookie': 'refresh=rt123; Path=/; HttpOnly' });

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/login', () => {
  it('returns token and me and sets mw_refresh httpOnly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(loginOk()).mockResolvedValueOnce(json(ME)),
    );
    const res = await POST(loginReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accessToken: 'tok', me: ME });
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('mw_refresh=rt123');
    expect(sc.toLowerCase()).toContain('httponly');
  });

  it('403 from org/me clears cookies with a generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(json({ error: { code: 'FORBIDDEN', message: 'not staff' } }, 403)),
    );
    const res = await POST(loginReq());
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('This account has no merchant access.');
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('mw_refresh=;');
    expect(sc).toContain('Max-Age=0');
    expect(sc).not.toContain('rt123');
  });

  it('propagates upstream 401 without cookies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({ error: { message: 'Invalid credentials' } }, 401)),
    );
    const res = await POST(loginReq());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 503 when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await POST(loginReq());
    expect(res.status).toBe(503);
  });
});

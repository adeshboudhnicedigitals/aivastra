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

function loginReq(extra: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3010/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
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

// The team API is asked first; a retailer's credentials fail there with 401.
const notStaff = () => json({ error: { message: 'invalid credentials' } }, 401);

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/login', () => {
  it('returns token and me and sets mw_refresh httpOnly', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(notStaff())
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(json(ME)),
    );
    const res = await POST(loginReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'merchant', accessToken: 'tok', me: ME });
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('mw_refresh=rt123');
    expect(sc.toLowerCase()).toContain('httponly');
  });

  it('403 from org/me clears cookies with a generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(notStaff())
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
      vi
        .fn()
        .mockResolvedValueOnce(notStaff())
        .mockResolvedValueOnce(json({ error: { message: 'Invalid credentials' } }, 401)),
    );
    const res = await POST(loginReq());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('forwards cf-connecting-ip on both upstream calls when present', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(notStaff())
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(ME));
    vi.stubGlobal('fetch', f);
    await POST(loginReq({ 'cf-connecting-ip': '203.0.113.7' }));
    for (const i of [0, 1, 2]) {
      expect(f.mock.calls[i]?.[1].headers['cf-connecting-ip']).toBe('203.0.113.7');
    }
  });

  it('sends no cf-connecting-ip when the visitor request has none', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(notStaff())
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(ME));
    vi.stubGlobal('fetch', f);
    await POST(loginReq());
    for (const i of [0, 1, 2]) {
      expect(f.mock.calls[i]?.[1].headers).not.toHaveProperty('cf-connecting-ip');
    }
  });

  it('returns 503 when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await POST(loginReq());
    expect(res.status).toBe(503);
  });

  it('team credentials open a console session: hq_refresh cookie, no mw_refresh', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        json({ accessToken: 'staff' }, 200, { 'set-cookie': 'refresh=adm1; Path=/admin/auth' }),
      )
      .mockResolvedValueOnce(json({ role: 'ADMIN', permissions: ['accounts.read'] }));
    vi.stubGlobal('fetch', f);
    const res = await POST(loginReq());
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe('console');
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('hq_refresh=adm1');
    expect(sc).not.toContain('mw_refresh=adm1');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('staff without accounts.read fall through to the retailer check', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: 'staff' }, 200, { 'set-cookie': 'refresh=adm1' }))
      .mockResolvedValueOnce(json({ role: 'MODERATOR', permissions: ['jobs.read'] }))
      .mockResolvedValueOnce(json({ error: { message: 'Invalid credentials' } }, 401));
    vi.stubGlobal('fetch', f);
    const res = await POST(loginReq());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('hq_refresh=adm1');
  });

  it('a team-API rate limit is passed through, not retried as retailer', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ error: { message: 'slow down' } }, 429));
    vi.stubGlobal('fetch', f);
    const res = await POST(loginReq());
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

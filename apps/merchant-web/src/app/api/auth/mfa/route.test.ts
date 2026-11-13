import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const req = (body: unknown) =>
  new NextRequest('http://localhost:3010/api/auth/mfa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/mfa', () => {
  it('rejects an unknown action without calling the API', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await POST(req({ action: 'login', mfaToken: 't' }));
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('verify: sets hq_refresh (not mw_refresh) once the role can see accounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ accessToken: 'tok' }, 200, { 'set-cookie': 'refresh=adm9; Path=/admin/auth' }),
        )
        .mockResolvedValueOnce(json({ permissions: ['accounts.read'] })),
    );
    const res = await POST(req({ action: 'verify', mfaToken: 't', code: '123456' }));
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe('console');
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('hq_refresh=adm9');
    expect(sc).not.toContain('mw_refresh');
  });

  it('verify: a role without accounts.read gets no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: 'tok' }, 200, { 'set-cookie': 'refresh=adm9' }))
        .mockResolvedValueOnce(json({ permissions: ['jobs.read'] })),
    );
    const res = await POST(req({ action: 'verify', mfaToken: 't', code: '123456' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('passes an API refusal (wrong code) through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({ error: { message: 'invalid code' } }, 401)),
    );
    const res = await POST(req({ action: 'verify', mfaToken: 't', code: '000000' }));
    expect(res.status).toBe(401);
  });

  it('enroll-start returns the secret without opening a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({ secret: 'ABC', otpauthUri: 'otpauth://x' })),
    );
    const res = await POST(req({ action: 'enroll-start', mfaToken: 't' }));
    expect(await res.json()).toEqual({ secret: 'ABC', otpauthUri: 'otpauth://x' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { safeJson } from './bff';
import { httpStatusMessage } from './errors';

describe('httpStatusMessage', () => {
  it('returns a non-empty message for a 502', () => {
    expect(httpStatusMessage(502).length).toBeGreaterThan(0);
  });
});

describe('safeJson', () => {
  it('maps a non-JSON 502 to an UPSTREAM_ERROR envelope', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 });
    const [body, ok] = await safeJson(res);
    expect(ok).toBe(false);
    expect(body).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });

  it('passes through JSON bodies with res.ok', async () => {
    const res = new Response(JSON.stringify({ a: 1 }), { status: 200 });
    expect(await safeJson(res)).toEqual([{ a: 1 }, true]);
  });
});

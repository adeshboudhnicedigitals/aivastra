import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant, memberAuthHeader } from '../helpers/merchant.js';

// Account console, phase 1 (spec §4): a token minted for the AiVastra console (audience
// 'admin') is for /admin/* only. merchant-web will hold one next to a retailer session, so the
// user-side routes must refuse it even when its subject is a real user.

let c: Containers;
let app: TestApp;
beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
}, 60_000);
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function adminAudienceHeader(userId: string) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m', 'admin');
  return { authorization: `Bearer ${token}` };
}
const get = (url: string, headers: Record<string, string>) =>
  app.inject({ method: 'GET', url, headers });

describe('admin-audience tokens on user routes', () => {
  it('are refused by requireUser, requireMerchantAdmin-style member routes and merchant routes', async () => {
    const m = await createTestMerchant(app);
    const admin = await adminAudienceHeader(m.userId);
    const normal = await memberAuthHeader(app, m.userId);

    // Same subject, same signature: only the audience differs.
    for (const url of [
      '/v1/credits',
      '/v1/merchant/org/me',
      '/v1/merchant/whatsapp-channel',
      '/v1/merchant/customers',
    ]) {
      expect((await get(url, admin)).statusCode, `${url} with console token`).toBe(401);
      expect((await get(url, normal)).statusCode, `${url} with user token`).not.toBe(401);
    }
  });
});

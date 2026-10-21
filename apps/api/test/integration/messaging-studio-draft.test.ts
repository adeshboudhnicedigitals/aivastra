import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudioDraftToken } from '../../src/modules/messaging/studio-draft';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
// Unique per run: integration files share one Postgres process.
const uniq = () => Math.floor(Math.random() * 1e9).toString();

describe('studio drafts', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {});
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('requires a logged-in user', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/studio/drafts/${'a'.repeat(32)}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns the draft to its owner', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `draft-${uniq()}@example.com`);
    const t = await createStudioDraftToken(app.redis, {
      userId,
      gender: 'women',
      garmentTypeId: 'gt-1',
      garmentKey: 'uploads/x.jpg',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${t}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gender: 'women',
      garmentTypeId: 'gt-1',
      garmentKey: 'uploads/x.jpg',
    });
  });

  it("is a 404 for someone else's draft, same as an unknown one", async () => {
    const owner = await createVerifiedUserToken(app, `draft-o-${uniq()}@example.com`);
    const other = await createVerifiedUserToken(app, `draft-x-${uniq()}@example.com`);
    const t = await createStudioDraftToken(app.redis, {
      userId: owner.userId,
      gender: 'men',
      garmentTypeId: 'gt-2',
      garmentKey: 'uploads/y.jpg',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${t}`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(404);
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/studio/drafts/${'b'.repeat(32)}`,
      headers: auth(other.token),
    });
    expect(missing.statusCode).toBe(404);
  });
});

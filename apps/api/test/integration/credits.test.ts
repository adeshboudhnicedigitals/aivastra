import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('credits', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerUser(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    return {
      token: res.json().accessToken,
      userId: JSON.parse(atob(res.json().accessToken.split('.')[1])).sub,
    };
  }

  it('GET /v1/credits returns balance + ledger', async () => {
    const { token, userId } = await registerUser('credits@x.com');
    await app.db
      .update(schema.userCredits)
      .set({ balance: 7 })
      .where(eq(schema.userCredits.userId, userId));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/credits',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().balance).toBe(7);
  });
});

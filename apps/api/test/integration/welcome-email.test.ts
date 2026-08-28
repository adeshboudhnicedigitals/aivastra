import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendVerificationEmail, sendWelcomeEmail } from '../../src/lib/mailer.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Both are mocked (real module otherwise) — the whole point of these tests is
// to pin down exactly when each fires relative to the other.
vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  };
});

let ctx: Containers;
let app: TestApp;

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('welcome email timing', () => {
  it('POST /v1/auth/register sends only the verification email, not the welcome email', async () => {
    vi.mocked(sendVerificationEmail).mockClear();
    vi.mocked(sendWelcomeEmail).mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'New User', email: 'newcomer@example.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(201);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();

    const [user] = await app.db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.email, 'newcomer@example.com'));
    expect(user?.emailVerified).toBe(false);
  });

  it('GET /v1/auth/verify-email sends the welcome email only after verification succeeds', async () => {
    vi.mocked(sendVerificationEmail).mockClear();
    vi.mocked(sendWelcomeEmail).mockClear();

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'Verify Me', email: 'verifyme@example.com', password: 'password123' },
    });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();

    const token = vi.mocked(sendVerificationEmail).mock.calls[0]?.[4];
    expect(token).toBeTruthy();

    const res = await app.inject({ method: 'GET', url: `/v1/auth/verify-email?token=${token}` });

    expect(res.statusCode).toBe(200);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      app.env.RESEND_API_KEY,
      app.env.EMAIL_FROM,
      'verifyme@example.com',
    );

    const [user] = await app.db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.email, 'verifyme@example.com'));
    expect(user?.emailVerified).toBe(true);
  });

  it('an invalid or expired verification token never triggers the welcome email', async () => {
    vi.mocked(sendWelcomeEmail).mockClear();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/verify-email?token=not-a-real-token',
    });

    expect(res.statusCode).toBe(400);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

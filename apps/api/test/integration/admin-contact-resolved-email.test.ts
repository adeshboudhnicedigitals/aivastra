import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendIssueResolvedEmail } from '../../src/lib/mailer.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Only sendIssueResolvedEmail is mocked (real module otherwise) — the route
// calls it fire-and-forget (logged on failure, never blocking the status
// update itself), same convention as report-received-email.test.ts.
vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return { ...actual, sendIssueResolvedEmail: vi.fn().mockResolvedValue(undefined) };
});

let ctx: Containers;
let app: TestApp;
let authHeader: Record<string, string>;

async function seedContactRequest(
  overrides: Partial<typeof schema.contactRequests.$inferInsert> = {},
) {
  const [row] = await app.db
    .insert(schema.contactRequests)
    .values({
      name: 'Jamie Doe',
      email: `contact-${Date.now()}-${Math.random()}@example.com`,
      phone: '9999999999',
      message: 'The pose generator keeps failing on my uploads',
      status: 'new',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('failed to seed contact request');
  return row;
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
});

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('admin contact requests — resolved email', () => {
  it("PATCH .../:id with status=done sends the resolution email to the requester's email with their issue text", async () => {
    vi.mocked(sendIssueResolvedEmail).mockClear();
    const row = await seedContactRequest();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/contact-requests/${row.id}`,
      headers: authHeader,
      payload: { status: 'done' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendIssueResolvedEmail).toHaveBeenCalledTimes(1);
    expect(sendIssueResolvedEmail).toHaveBeenCalledWith(
      app.env.RESEND_API_KEY,
      app.env.EMAIL_FROM,
      row.email,
      row.message,
    );
  });

  it('PATCH .../:id with status=read does not send the resolution email', async () => {
    vi.mocked(sendIssueResolvedEmail).mockClear();
    const row = await seedContactRequest();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/contact-requests/${row.id}`,
      headers: authHeader,
      payload: { status: 'read' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendIssueResolvedEmail).not.toHaveBeenCalled();
  });

  it('re-marking an already-done request done again does not re-send the email', async () => {
    vi.mocked(sendIssueResolvedEmail).mockClear();
    const row = await seedContactRequest({ status: 'done' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/contact-requests/${row.id}`,
      headers: authHeader,
      payload: { status: 'done' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendIssueResolvedEmail).not.toHaveBeenCalled();
  });

  it('falls back to a generic issue description when the request has no message', async () => {
    vi.mocked(sendIssueResolvedEmail).mockClear();
    const row = await seedContactRequest({ message: null });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/contact-requests/${row.id}`,
      headers: authHeader,
      payload: { status: 'done' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendIssueResolvedEmail).toHaveBeenCalledWith(
      app.env.RESEND_API_KEY,
      app.env.EMAIL_FROM,
      row.email,
      'Your reported issue',
    );
  });

  it('a failed send does not fail the status-update request', async () => {
    vi.mocked(sendIssueResolvedEmail).mockClear();
    vi.mocked(sendIssueResolvedEmail).mockRejectedValueOnce(new Error('Resend unreachable'));
    const row = await seedContactRequest();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/contact-requests/${row.id}`,
      headers: authHeader,
      payload: { status: 'done' },
    });

    expect(res.statusCode).toBe(200);
    const [updated] = await app.db
      .select({ status: schema.contactRequests.status })
      .from(schema.contactRequests)
      .where(eq(schema.contactRequests.id, row.id));
    expect(updated?.status).toBe('done');
  });
});

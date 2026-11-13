import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptPhone, phoneHash } from '../../src/modules/crm/crypto';
import { csvCell, maskPhone } from '../../src/modules/crm/customers.routes';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// CRM phase 4: customer list, profile, export, segments, deletion.

const KEY = randomBytes(32).toString('base64');
let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { CRM_DATA_KEY: KEY, CRM_IDENTIFY_ENABLED: true });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });

async function ctx() {
  const m = await createTestMerchant(app);
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  return { m, branch, device, auth: await memberAuthHeader(app, m.userId) };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

let n = 0;
async function shopper(
  x: Ctx,
  o: {
    name?: string | null;
    marketing?: boolean;
    tried?: number;
    sold?: number;
    daysAgo?: number;
  } = {},
) {
  const phone = `9198${String(++n + 40_000).padStart(8, '0')}`;
  const [s] = await app.db
    .insert(schema.shoppers)
    .values({
      merchantId: x.m.merchantId,
      phoneEnc: encryptPhone(KEY, phone),
      phoneHash: phoneHash(KEY, phone),
      displayName: o.name === undefined ? 'Priya' : o.name,
      lastSeenAt: new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000),
    })
    .returning();
  const [session] = await app.db
    .insert(schema.instoreSessions)
    .values({
      merchantId: x.m.merchantId,
      branchId: x.branch.id,
      deviceId: x.device.deviceId,
      mode: 'kiosk',
      shopperId: s!.id,
    })
    .returning();
  const items = [...Array(o.tried ?? 0).fill('tried'), ...Array(o.sold ?? 0).fill('sold')] as Array<
    'tried' | 'sold'
  >;
  for (const action of items) {
    await app.db
      .insert(schema.sessionItems)
      .values({ sessionId: session!.id, catalogItemId: randomUUID(), action });
  }
  await app.db.insert(schema.shopperConsents).values({
    shopperId: s!.id,
    merchantId: x.m.merchantId,
    kind: 'marketing',
    granted: o.marketing ?? false,
    version: 'v0-draft',
    source: 'whatsapp_button',
  });
  return { id: s!.id, phone, sessionId: session!.id };
}

describe('helpers', () => {
  it('masks all but the country code, two digits and the last three', () => {
    expect(maskPhone('919876543210')).toBe('+91 98•••••210');
  });
  it('defuses spreadsheet formulas and quotes commas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});

describe('customer list', () => {
  it('lists with masked phones, counts and consent; newest first', async () => {
    const x = await ctx();
    const older = await shopper(x, { name: 'Older', daysAgo: 5, tried: 1 });
    const newer = await shopper(x, { name: 'Newer', tried: 3, sold: 1, marketing: true });
    const res = await req('GET', '/v1/merchant/customers', x.auth);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id]);
    expect(body.items[0]).toMatchObject({
      visits: 1,
      tryOns: 3,
      purchases: 1,
      consents: { marketing: true },
    });
    expect(res.body).not.toContain(newer.phone);
    expect(body.items[0].phone).toMatch(/•/);
  });

  it('filters: name, exact phone, marketing, min visits; pages by cursor', async () => {
    const x = await ctx();
    const a = await shopper(x, { name: 'Anita', marketing: true });
    await shopper(x, { name: 'Bina' });
    await shopper(x, { name: null, daysAgo: 2 });
    const get = async (qs: string) =>
      (await req('GET', `/v1/merchant/customers?${qs}`, x.auth)).json().items as Array<{
        id: string;
      }>;

    expect((await get('q=anit')).map((i) => i.id)).toEqual([a.id]);
    expect((await get(`q=${a.phone}`)).map((i) => i.id)).toEqual([a.id]);
    expect((await get('marketing=yes')).map((i) => i.id)).toEqual([a.id]);
    expect(await get('marketing=no')).toHaveLength(2);
    expect(await get('minVisits=2')).toHaveLength(0);

    const p1 = (await req('GET', '/v1/merchant/customers?limit=2', x.auth)).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (
      await req('GET', `/v1/merchant/customers?limit=2&cursor=${p1.nextCursor}`, x.auth)
    ).json();
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect((await req('GET', '/v1/merchant/customers?cursor=garbage', x.auth)).statusCode).toBe(
      400,
    );
  });

  it('never shows another merchant or wiped customers, and staff get 403 everywhere', async () => {
    const x = await ctx();
    const other = await ctx();
    const mine = await shopper(x);
    const theirs = await shopper(other);
    const list = (await req('GET', '/v1/merchant/customers', x.auth)).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([mine.id]);
    expect((await req('GET', `/v1/merchant/customers/${theirs.id}`, x.auth)).statusCode).toBe(404);
    expect((await req('DELETE', `/v1/merchant/customers/${theirs.id}`, x.auth)).statusCode).toBe(
      404,
    );

    const staff = await createTestStaff(app, x.m.merchantId, x.branch.id);
    for (const [method, url] of [
      ['GET', '/v1/merchant/customers'],
      ['GET', `/v1/merchant/customers/${mine.id}`],
      ['GET', '/v1/merchant/customers/export.csv'],
      ['DELETE', `/v1/merchant/customers/${mine.id}`],
      ['GET', '/v1/merchant/customer-segments'],
    ] as const) {
      expect((await req(method, url, staff.auth)).statusCode, url).toBe(403);
    }
  });
});

describe('profile and export', () => {
  it('a profile shows the full number and is audited', async () => {
    const x = await ctx();
    const s = await shopper(x, { tried: 2, sold: 1, marketing: true });
    const res = await req('GET', `/v1/merchant/customers/${s.id}`, x.auth);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.phone).toBe(s.phone);
    expect(p.visitsList).toHaveLength(1);
    expect(p.visitsList[0]).toMatchObject({ tried: 2, sold: 1 });
    expect(p.consentHistory[0]).toMatchObject({ kind: 'marketing', granted: true });
    const [audit] = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'customer.view'));
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(s.phone);
  });

  it('exports CSV with full numbers and consent, filtered, and audits filter and row count', async () => {
    const x = await ctx();
    const yes = await shopper(x, { name: '=cmd', marketing: true });
    await shopper(x, { name: 'No' });
    const res = await req('GET', '/v1/merchant/customers/export.csv?marketing=yes', x.auth);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(yes.phone);
    expect(lines[1]).toContain("'=cmd");
    expect(lines[1]).toMatch(/,yes$/);
    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'customer.export'));
    const mine = audits.find((a) => a.resourceId === x.m.merchantId);
    expect(mine?.after).toMatchObject({ rows: 1, filters: { marketing: 'yes' } });
  });
});

describe('segments', () => {
  it('saves, lists, rejects a duplicate name, isolates merchants and deletes', async () => {
    const x = await ctx();
    const other = await ctx();
    const body = { name: 'VIPs', filters: { marketing: 'yes', minVisits: 3 } };
    const created = await req('POST', '/v1/merchant/customer-segments', x.auth, body);
    expect(created.statusCode).toBe(201);
    expect((await req('POST', '/v1/merchant/customer-segments', x.auth, body)).statusCode).toBe(
      409,
    );
    const list = (await req('GET', '/v1/merchant/customer-segments', x.auth)).json();
    expect(list.items).toEqual([
      { id: created.json().id, name: 'VIPs', filters: { marketing: 'yes', minVisits: 3 } },
    ]);
    expect((await req('GET', '/v1/merchant/customer-segments', other.auth)).json().items).toEqual(
      [],
    );
    expect(
      (await req('DELETE', `/v1/merchant/customer-segments/${created.json().id}`, other.auth))
        .statusCode,
    ).toBe(404);
    expect(
      (await req('DELETE', `/v1/merchant/customer-segments/${created.json().id}`, x.auth))
        .statusCode,
    ).toBe(204);
  });
});

describe('deletion on request', () => {
  it('wipes the profile and every photo of the shopper, keeps others, and audits', async () => {
    const x = await ctx();
    const s = await shopper(x);
    const keep = await shopper(x);
    const jobId = randomUUID();
    const photo = keys.merchantTryonInput(x.m.merchantId, randomUUID(), 'jpg');
    const result = keys.output(jobId);
    for (const k of [photo, result]) await app.storage.putObject(k, Buffer.from('x'), 'image/png');
    await app.db.insert(schema.jobs).values({
      id: jobId,
      merchantId: x.m.merchantId,
      userId: x.m.userId,
      status: 'COMPLETED',
      creditsCharged: 5,
      source: 'merchant_tryon',
      sessionId: s.sessionId,
      branchId: x.branch.id,
      deviceId: x.device.deviceId,
      customerPhotoKey: photo,
    });
    await app.db.insert(schema.jobOutputs).values({ jobId, resultKey: result });

    expect((await req('DELETE', `/v1/merchant/customers/${s.id}`, x.auth)).statusCode).toBe(204);

    const [row] = await app.db.select().from(schema.shoppers).where(eq(schema.shoppers.id, s.id));
    expect(row).toMatchObject({ phoneEnc: null, phoneHash: null, displayName: null });
    expect(row!.deletedAt).not.toBeNull();
    for (const k of [photo, result]) {
      expect(
        await app.storage.headObject(k).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    }
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job!.customerPhotoKey).toBeNull();
    const [sess] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(eq(schema.instoreSessions.id, s.sessionId));
    expect(sess!.shopperId).toBeNull();

    const list = (await req('GET', '/v1/merchant/customers', x.auth)).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([keep.id]);
    expect((await req('GET', `/v1/merchant/customers/${s.id}`, x.auth)).statusCode).toBe(404);
    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'customer.delete'));
    expect(audits.some((a) => a.resourceId === s.id)).toBe(true);
  });
});

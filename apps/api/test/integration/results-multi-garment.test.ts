import { schema } from '@aivastra/db';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Some tryon jobs upload more than one garment image: a 2-input job (e.g. kurthi
// + pyjama) sets upper_garment_key + lower_garment_key, a 3-input job (e.g.
// chudidhar) additionally sets third_garment_key. The /results webtool and its
// bundle download must surface every uploaded garment, not just one.
describe('/results shows and bundles every uploaded garment, not just one', () => {
  let c: Containers;
  let app: TestApp;
  let nextTestClient = 1;
  let cookie: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    const password = 'password123';
    const passwordHash = await hashPassword(password);
    const [admin] = await app.db
      .insert(schema.users)
      .values({
        email: 'results-admin@x.com',
        passwordHash,
        displayName: 'Results Admin',
        emailVerified: true,
      })
      .returning();
    await app.db.insert(schema.adminUsers).values({
      userId: admin.id,
      role: 'ADMIN',
      status: 'active',
      passwordHash,
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/results/login',
      remoteAddress: `127.0.0.${nextTestClient++}`,
      payload: { email: 'results-admin@x.com', password },
    });
    const setCookie = loginRes.cookies.find((ck) => ck.name === 'results_access_token');
    cookie = `results_access_token=${setCookie?.value}`;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedGarmentJob(opts: {
    userEmail: string;
    upper?: boolean;
    lower?: boolean;
    third?: boolean;
    flagged?: boolean;
  }) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: opts.userEmail, emailVerified: true })
      .returning();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'COMPLETED',
        creditsCharged: 5,
        source: 'tryon',
        flagged: !!opts.flagged,
        flagReason: opts.flagged ? 'texture_issue' : null,
        flaggedAt: opts.flagged ? new Date() : null,
      })
      .returning();

    const upperGarmentKey = opts.upper ? `test/${job.id}/upper.jpg` : null;
    const lowerGarmentKey = opts.lower ? `test/${job.id}/lower.jpg` : null;
    const thirdGarmentKey = opts.third ? `test/${job.id}/third.jpg` : null;

    for (const key of [upperGarmentKey, lowerGarmentKey, thirdGarmentKey]) {
      if (key) await app.storage.putObject(key, Buffer.from(`bytes-${key}`), 'image/jpeg');
    }

    await app.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey,
      lowerGarmentKey,
      thirdGarmentKey,
    });

    return { jobId: job.id as string, upperGarmentKey, lowerGarmentKey, thirdGarmentKey };
  }

  it('GET /results/data returns every garment for a 2-input job, not just one', async () => {
    const { jobId } = await seedGarmentJob({
      userEmail: 'two-input@x.com',
      upper: true,
      lower: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/results/data?status=all&pageSize=100',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === jobId);
    expect(item).toBeTruthy();
    expect(Array.isArray(item.garments)).toBe(true);
    expect(item.garments.length).toBe(2);
  });

  it('GET /results/data returns every garment for a 3-input job, not just one', async () => {
    const { jobId } = await seedGarmentJob({
      userEmail: 'three-input@x.com',
      upper: true,
      lower: true,
      third: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/results/data?status=all&pageSize=100',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === jobId);
    expect(item).toBeTruthy();
    expect(item.garments.length).toBe(3);
  });

  it('bundle download zips every garment for a 3-input flagged job', async () => {
    const { jobId } = await seedGarmentJob({
      userEmail: 'three-input-bundle@x.com',
      upper: true,
      lower: true,
      third: true,
      flagged: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/bundle`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const zip = new AdmZip(res.rawPayload);
    const names = zip.getEntries().map((e) => e.entryName);
    const garmentFiles = names.filter((n) => n.startsWith('inputs/garment'));
    expect(garmentFiles.length).toBe(3);
  });

  it('bundle download still zips one garment file for a single-input flagged job', async () => {
    const { jobId } = await seedGarmentJob({
      userEmail: 'one-input-bundle@x.com',
      upper: true,
      flagged: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/bundle`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const zip = new AdmZip(res.rawPayload);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('inputs/garment.jpg');
  });
});

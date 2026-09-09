import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin sample videos CRUD', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('presign -> confirm -> list -> patch -> delete', async () => {
    const presignRes = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos/presign',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        videoContentType: 'video/mp4',
        thumbnailContentType: 'image/gif',
      }),
    });
    expect(presignRes.statusCode).toBe(200);
    const presign = presignRes.json();
    expect(presign.videoUploadUrl).toBeTruthy();
    expect(presign.thumbnailUploadUrl).toBeTruthy();
    expect(presign.videoR2Key).toMatch(/^sample-videos\/.+\.mp4$/);
    expect(presign.thumbnailR2Key).toMatch(/^sample-videos\/.+\.thumb\.gif$/);

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Slow turn',
        videoR2Key: presign.videoR2Key,
        thumbnailR2Key: presign.thumbnailR2Key,
        prompt: 'model turns slowly to show the garment from all angles',
        sortOrder: 1,
        duration: 8,
        quality: '720p',
      }),
    });
    expect(confirmRes.statusCode).toBe(200);
    const created = confirmRes.json();
    expect(created.id).toBeTruthy();
    expect(created.isActive).toBe(true);
    expect(created.videoUrl).toContain('X-Amz-Signature');
    expect(created.thumbnailUrl).toContain('X-Amz-Signature');

    const listRes = await app.inject({
      method: 'GET',
      url: '/admin/assets/sample-videos',
      headers: adminAuth,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json().items as Array<{
      id: string;
      videoUrl: string;
      thumbnailUrl: string;
    }>;
    const listedCreated = listed.find((row) => row.id === created.id);
    expect(listedCreated).toBeDefined();
    expect(listedCreated?.videoUrl).toContain('X-Amz-Signature');
    expect(listedCreated?.thumbnailUrl).toContain('X-Amz-Signature');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ isActive: false }),
    });
    expect(patchRes.statusCode).toBe(200);
    const [afterPatch] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterPatch.isActive).toBe(false);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: adminAuth,
    });
    expect(deleteRes.statusCode).toBe(200);
    const [afterDelete] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterDelete.deletedAt).not.toBeNull();

    const listRes2 = await app.inject({
      method: 'GET',
      url: '/admin/assets/sample-videos',
      headers: adminAuth,
    });
    expect(listRes2.json().items.map((r: { id: string }) => r.id)).not.toContain(created.id);
  });

  it('creates with explicit duration/quality; patch cannot change them', async () => {
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Runway walk',
        videoR2Key: 'sample-videos/runway.mp4',
        thumbnailR2Key: 'sample-videos/runway.thumb.gif',
        prompt: 'model walks the runway',
        sortOrder: 0,
        duration: 12,
        quality: '1080p',
      }),
    });
    expect(confirmRes.statusCode).toBe(200);
    const created = confirmRes.json();
    expect(created.duration).toBe(12);
    expect(created.quality).toBe('1080p');

    // duration/quality are no longer part of PatchSampleVideoBody — a request
    // that still sends them is not rejected (Zod strips unknown keys by
    // default, no .strict() in this repo), it's just a no-op on those keys.
    // isActive and sortOrder are the only fields the schema still accepts
    // (both optional, since neither is a PixVerse generation input).
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ isActive: true, duration: 5, quality: '360p' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const [afterPatch] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterPatch.duration).toBe(12);
    expect(afterPatch.quality).toBe('1080p');
    expect(afterPatch.isActive).toBe(true);

    const sortPatchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ sortOrder: 5 }),
    });
    expect(sortPatchRes.statusCode).toBe(200);
    const [afterSortPatch] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterSortPatch.sortOrder).toBe(5);
  });

  it('rejects create without duration/quality — they are required fields, not defaulted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'No duration/quality',
        videoR2Key: 'sample-videos/nodq.mp4',
        thumbnailR2Key: 'sample-videos/nodq.thumb.gif',
        prompt: 'p',
        sortOrder: 0,
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duration outside 1-15 on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Bad',
        videoR2Key: 'sample-videos/bad.mp4',
        thumbnailR2Key: 'sample-videos/bad.thumb.gif',
        prompt: 'p',
        sortOrder: 0,
        duration: 16,
        quality: '720p',
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unrecognized quality value on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Bad',
        videoR2Key: 'sample-videos/bad2.mp4',
        thumbnailR2Key: 'sample-videos/bad2.thumb.gif',
        prompt: 'p',
        sortOrder: 0,
        duration: 8,
        quality: '4k',
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-mp4 content type on presign', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/sample-videos/presign',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        videoContentType: 'video/webm',
        thumbnailContentType: 'image/gif',
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

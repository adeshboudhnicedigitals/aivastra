import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { syncProduct } from '../src/modules/shopify/products.sync.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 5).toString('base64');
let c: Containers;
let app: TestApp;
let storeId: string;

let workflowTemplateId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 7,
      shopDomain: 's.myshopify.com',
      myshopifyDomain: 's.myshopify.com',
      name: 'S',
      email: 's@s.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'sync-test',
      label: 'Sync Test WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: [],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();
  workflowTemplateId = wf.id;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

const mockFetch = (async () =>
  ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Map([['content-type', 'image/jpeg']]),
  }) as unknown as Response) as typeof fetch;

describe('syncProduct', () => {
  it('uploads first image to R2 and upserts an active garment row', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Map([['content-type', 'image/jpeg']]),
      }) as unknown as Response) as typeof fetch;
    await syncProduct(
      app,
      storeId,
      { id: 42, title: 'Test Product', image: { src: 'https://cdn.shopify.com/x.jpg' } },
      fakeFetch,
    );
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 42),
        ),
      );
    expect(row.status).toBe('active');
    expect(row.title).toBe('Test Product');
    expect(row.r2Key).toBe(`shopify-garments/${storeId}/42/garment.jpg`);
    const head = await app.storage.headObject(row.r2Key);
    expect(head.contentLength).toBe(3);
  });

  it('marks failed when a product has no image', async () => {
    const fakeFetch = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    await syncProduct(app, storeId, { id: 43, title: 'No Image Product', image: null }, fakeFetch);
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 43),
        ),
      );
    expect(row.status).toBe('failed');
    expect(row.failedReason).toBeTruthy();
  });

  it('requests redirect: "error" and a live AbortSignal, so a CDN redirect to an off-allowlist host is never followed', async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Map([['content-type', 'image/jpeg']]),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await syncProduct(
      app,
      storeId,
      {
        id: 44,
        title: 'Redirect Check Product',
        image: { src: 'https://cdn.shopify.com/redirect-check.jpg' },
      },
      fakeFetch,
    );
    expect(capturedInit?.redirect).toBe('error');
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);

    // Simulate what real fetch does when redirect: 'error' hits a 3xx: it throws instead
    // of following it, which must land in the existing failed-status path.
    const redirectingFetch = (async () => {
      throw new TypeError('unexpected redirect');
    }) as unknown as typeof fetch;
    await syncProduct(
      app,
      storeId,
      {
        id: 45,
        title: 'Redirects Elsewhere Product',
        image: { src: 'https://cdn.shopify.com/redirects-elsewhere.jpg' },
      },
      redirectingFetch,
    );
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 45),
        ),
      );
    expect(row.status).toBe('failed');
    expect(row.failedReason).toContain('redirect');
  });

  it('marks failed when the content-length header exceeds the 10MB cap, without downloading the body', async () => {
    let arrayBufferCalled = false;
    const fakeFetch = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => {
          arrayBufferCalled = true;
          return new Uint8Array([1, 2, 3]).buffer;
        },
        headers: new Map([
          ['content-type', 'image/jpeg'],
          ['content-length', String(11 * 1024 * 1024)],
        ]),
      }) as unknown as Response) as typeof fetch;
    await syncProduct(
      app,
      storeId,
      { id: 46, title: 'Big Product', image: { src: 'https://cdn.shopify.com/big.jpg' } },
      fakeFetch,
    );
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 46),
        ),
      );
    expect(row.status).toBe('failed');
    expect(row.failedReason).toContain('10MB');
    expect(arrayBufferCalled).toBe(false);
  });

  it('marks failed when the actual downloaded body exceeds the 10MB cap (no content-length header)', async () => {
    const oversized = new Uint8Array(11 * 1024 * 1024);
    const fakeFetch = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => oversized.buffer,
        headers: new Map([['content-type', 'image/jpeg']]),
      }) as unknown as Response) as typeof fetch;
    await syncProduct(
      app,
      storeId,
      {
        id: 47,
        title: 'Big No Header Product',
        image: { src: 'https://cdn.shopify.com/big-no-header.jpg' },
      },
      fakeFetch,
    );
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 47),
        ),
      );
    expect(row.status).toBe('failed');
    expect(row.failedReason).toContain('10MB');
  });

  it('persists product_type/tags/vendor and leaves funnel unassigned with no matching rule', async () => {
    await syncProduct(
      app,
      storeId,
      {
        id: 501,
        title: 'Test Shirt',
        image: { src: 'https://cdn.shopify.com/shirt.jpg' },
        product_type: 'Shirts',
        tags: 'Sale, Cotton',
        vendor: 'Acme Co',
      },
      mockFetch,
    );

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 501),
        ),
      );
    expect(row.productType).toBe('Shirts');
    expect(row.tags).toEqual(['Sale', 'Cotton']);
    expect(row.vendor).toBe('Acme Co');
    expect(row.funnelTemplateId).toBeNull();
    expect(row.funnelAssignmentSource).toBeNull();
  });

  it('auto-assigns a funnel template when an automated rule matches', async () => {
    const [template] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({ slug: 'upper-test', label: 'Upper', workflowTemplateId })
      .returning();
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId,
      funnelTemplateId: template.id,
      mode: 'automated',
      conditions: [{ field: 'product_type', operator: 'equals', value: 'Shirts' }],
      priority: 0,
    });

    await syncProduct(
      app,
      storeId,
      {
        id: 502,
        title: 'Auto-Assigned Shirt',
        image: { src: 'https://cdn.shopify.com/shirt2.jpg' },
        product_type: 'Shirts',
        tags: '',
        vendor: 'Acme Co',
      },
      mockFetch,
    );

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 502),
        ),
      );
    expect(row.funnelTemplateId).toBe(template.id);
    expect(row.funnelAssignmentSource).toBe('automated');
  });

  it('does not overwrite a manually-assigned funnel on re-sync', async () => {
    const [manualTemplate] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({ slug: 'manual-test', label: 'Manual Pick', workflowTemplateId })
      .returning();

    await syncProduct(
      app,
      storeId,
      {
        id: 503,
        title: 'Manually Pinned',
        image: { src: 'https://cdn.shopify.com/shirt3.jpg' },
        product_type: 'Shirts',
        tags: '',
        vendor: '',
      },
      mockFetch,
    );
    const [before] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 503),
        ),
      );
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ funnelTemplateId: manualTemplate.id, funnelAssignmentSource: 'manual' })
      .where(eq(schema.shopifyProductGarments.id, before.id));

    await syncProduct(
      app,
      storeId,
      {
        id: 503,
        title: 'Manually Pinned (re-synced)',
        image: { src: 'https://cdn.shopify.com/shirt3.jpg' },
        product_type: 'Pants',
        tags: '',
        vendor: '',
      },
      mockFetch,
    );
    const [after] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 503),
        ),
      );
    expect(after.funnelTemplateId).toBe(manualTemplate.id);
    expect(after.funnelAssignmentSource).toBe('manual');
  });

  it('persists collections and auto-assigns a funnel via a collections rule', async () => {
    const [template] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({ slug: 'collections-test', label: 'Collections', workflowTemplateId })
      .returning();
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId,
      funnelTemplateId: template.id,
      mode: 'automated',
      conditions: [{ field: 'collections', operator: 'equals', value: 'Summer Sale' }],
      priority: 0,
    });

    await syncProduct(
      app,
      storeId,
      {
        id: 504,
        title: 'Summer Shirt',
        image: { src: 'https://cdn.shopify.com/shirt4.jpg' },
        collections: ['Summer Sale', 'New Arrivals'],
      },
      mockFetch,
    );

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 504),
        ),
      );
    expect(row.collections).toEqual(['Summer Sale', 'New Arrivals']);
    expect(row.funnelTemplateId).toBe(template.id);
    expect(row.funnelAssignmentSource).toBe('automated');
  });
});

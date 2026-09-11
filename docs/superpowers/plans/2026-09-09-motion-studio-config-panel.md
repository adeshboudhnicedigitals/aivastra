# Motion Studio config panel (right section) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder right-column card on the Motion Studio main screen (`apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`) with a real configuration panel: pick a preset (admin-curated `sample_videos` row) or go Custom (duration + quality, no prompt field), review, and generate. Delete `CatalogVideoWizard.tsx` once nothing calls it.

**Architecture:** Backend gains a custom (no-`sampleVideoId`) branch on `POST /v1/jobs/catalog-video`, priced by the same formula presets already use, plus a `pixverseVideoPricing` field on `GET /v1/models/sample-videos` for a client-side cost preview. Frontend gains a new `ConfigPanel.tsx` (two internal steps: select, review) and a "chosen" preview state on `SourcePanel.tsx`, wired together in `page.tsx` via a lifted `source` state that replaces the current `wizardSource`.

**Tech Stack:** TypeScript, Zod (`packages/types`), Fastify + `fastify-type-provider-zod` (`apps/api`), React + Next.js App Router (`apps/catalogues-web`), `@tanstack/react-query`, Vitest integration tests.

## Global Constraints

- Custom mode has **no prompt field** for the end user. The server fills in one fixed constant prompt (`PIXVERSE_CUSTOM_VIDEO_PROMPT`) — not admin-configurable, not user-configurable.
- Generate is **two clicks**: Select (preset or custom) → Continue → Review (source + config + cost) → Generate. Not an immediate one-click submit from the select step.
- The server is the sole source of truth for the charged cost. Anything the client computes for a live preview is cosmetic only — `createCatalogVideoJob` always recomputes via `getPixverseVideoCreditCost` before charging, exactly like the existing preset path.
- No dispatcher changes. `processVideoJob` (`apps/dispatcher/src/job/processor.ts`) already reads `prompt`/`duration`/`quality` generically off `job_inputs.params` — nothing here should touch `apps/dispatcher`.
- No `.strict()` on any Zod schema — this repo has zero `.strict()` precedent in `packages/types/src`.
- No DB schema or migration changes.
- Design doc: `docs/superpowers/specs/2026-09-09-motion-studio-config-panel-design.md`.
- `apps/admin-mobile` is out of scope — do not touch it.

---

### Task 1: Expose `pixverseVideoPricing` on `GET /v1/models/sample-videos`

**Files:**
- Modify: `apps/api/src/lib/resolution-config.ts`
- Modify: `apps/api/src/modules/models/routes.ts`
- Modify: `apps/api/test/integration/sample-videos-public.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getPixverseVideoPricingConfig(app): Promise<PixverseVideoPricingConfig>` (exported from `apps/api/src/lib/resolution-config.ts`) — Task 4 (frontend `ConfigPanel.tsx`) consumes the resulting `pixverseVideoPricing` field on the `/v1/models/sample-videos` response, not this function directly (that endpoint is server-only).

- [ ] **Step 1: Write the failing test**

Open `apps/api/test/integration/sample-videos-public.test.ts` and add a new `it()` right after the existing one (still inside the same `describe` block, before the closing `});` at the end of the file):

```ts
  it('also returns the resolved pixverseVideoPricing config, merged with defaults', async () => {
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 3,
          // Only 720p overridden — 360p/540p/1080p must fall back to the
          // default qualityBase (150) rather than come back undefined.
          qualityBase: { '720p': 40 },
        },
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/sample-videos',
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pixverseVideoPricing).toEqual({
      perSecondRate: 3,
      qualityBase: { '360p': 150, '540p': 150, '720p': 40, '1080p': 150 },
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root, requires `pnpm docker:up` running):
```bash
npx vitest run --config vitest.integration.config.ts sample-videos-public
```
(run from `apps/api`)

Expected: FAIL — `body.pixverseVideoPricing` is `undefined`.

- [ ] **Step 3: Extract `getPixverseVideoPricingConfig` in `resolution-config.ts`**

Current code (`apps/api/src/lib/resolution-config.ts`, the `getPixverseVideoCreditCost` function — find it via the doc comment starting "Reads the admin-configured PixVerse duration/quality pricing formula"):

```ts
export async function getPixverseVideoCreditCost(
  app: FastifyInstance,
  duration: number,
  quality: PixverseQuality,
): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const stored = cfg.pixverseVideoPricing as Partial<PixverseVideoPricingConfig> | undefined;
    const pricing: PixverseVideoPricingConfig = {
      perSecondRate:
        typeof stored?.perSecondRate === 'number'
          ? stored.perSecondRate
          : DEFAULT_PIXVERSE_VIDEO_PRICING.perSecondRate,
      qualityBase: { ...DEFAULT_PIXVERSE_VIDEO_PRICING.qualityBase, ...stored?.qualityBase },
    };
    return computePixverseVideoCost(duration, quality, pricing);
  } catch {
    return computePixverseVideoCost(duration, quality, DEFAULT_PIXVERSE_VIDEO_PRICING);
  }
}
```

Replace it with (same file, same location — this is a behavior-preserving split, not a rewrite: the merge-with-defaults logic moves into its own exported function, and the cost function becomes a two-line wrapper around it):

```ts
/**
 * Reads the admin-configured PixVerse duration/quality pricing formula from
 * the `config:system` Redis key, merged per-key against
 * DEFAULT_PIXVERSE_VIDEO_PRICING. `SystemConfigBody.pixverseVideoPricing`
 * lets an admin PATCH just one quality tier (`qualityBase` is a Zod
 * `.partial()`), so a stored config can legitimately be missing tiers — an
 * existence check (`cfg.pixverseVideoPricing ?? DEFAULT`) would let a
 * partial `qualityBase` reach computePixverseVideoCost, which indexes it
 * directly with no fallback — `undefined + number` is `NaN`. Exported so
 * both getPixverseVideoCreditCost() (below) and the public
 * GET /v1/models/sample-videos response (apps/api/src/modules/models/routes.ts)
 * can read the same resolved config — the route exposes it for a
 * client-side Custom-mode cost preview; the server still recomputes the
 * charged cost itself at job-creation time regardless of what the client
 * showed.
 */
export async function getPixverseVideoPricingConfig(
  app: FastifyInstance,
): Promise<PixverseVideoPricingConfig> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const stored = cfg.pixverseVideoPricing as Partial<PixverseVideoPricingConfig> | undefined;
    return {
      perSecondRate:
        typeof stored?.perSecondRate === 'number'
          ? stored.perSecondRate
          : DEFAULT_PIXVERSE_VIDEO_PRICING.perSecondRate,
      qualityBase: { ...DEFAULT_PIXVERSE_VIDEO_PRICING.qualityBase, ...stored?.qualityBase },
    };
  } catch {
    return DEFAULT_PIXVERSE_VIDEO_PRICING;
  }
}

export async function getPixverseVideoCreditCost(
  app: FastifyInstance,
  duration: number,
  quality: PixverseQuality,
): Promise<number> {
  const pricing = await getPixverseVideoPricingConfig(app);
  return computePixverseVideoCost(duration, quality, pricing);
}
```

- [ ] **Step 4: Add the field to the route response**

In `apps/api/src/modules/models/routes.ts`, update the import (currently `import { getPixverseVideoCreditCost } from '../../lib/resolution-config.js';`):

```ts
import { getPixverseVideoCreditCost, getPixverseVideoPricingConfig } from '../../lib/resolution-config.js';
```

Then in the `/v1/models/sample-videos` handler, change:

```ts
    return {
      items: await Promise.all(
        rows.map(async (row) => {
          const [thumbnail, video, creditCost] = await Promise.all([
            app.storage.presignGet(row.thumbnailR2Key, 3_600),
            app.storage.presignGet(row.videoR2Key, 3_600),
            getPixverseVideoCreditCost(app, row.duration, row.quality as PixverseQuality),
          ]);

          return {
            id: row.id,
            title: row.title,
            thumbnailUrl: thumbnail.url,
            previewVideoUrl: video.url,
            creditCost,
          };
        }),
      ),
    };
```

to:

```ts
    const [items, pixverseVideoPricing] = await Promise.all([
      Promise.all(
        rows.map(async (row) => {
          const [thumbnail, video, creditCost] = await Promise.all([
            app.storage.presignGet(row.thumbnailR2Key, 3_600),
            app.storage.presignGet(row.videoR2Key, 3_600),
            getPixverseVideoCreditCost(app, row.duration, row.quality as PixverseQuality),
          ]);

          return {
            id: row.id,
            title: row.title,
            thumbnailUrl: thumbnail.url,
            previewVideoUrl: video.url,
            creditCost,
          };
        }),
      ),
      // Lets the Motion Studio client compute a live Custom-mode cost preview
      // via computePixverseVideoCost without a second round-trip — see
      // getPixverseVideoPricingConfig's doc comment.
      getPixverseVideoPricingConfig(app),
    ]);
    return { items, pixverseVideoPricing };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts sample-videos-public` (from `apps/api`)
Expected: PASS, both tests in the file.

- [ ] **Step 6: Run the full file plus the access-gate test that shares this route**

```bash
npx vitest run --config vitest.integration.config.ts sample-videos-public catalog-video-access-gate
```
Expected: all pass — confirms the reordering/extraction didn't change the 403 gate behavior for `GET /v1/models/sample-videos`.

- [ ] **Step 7: Typecheck the API package**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/resolution-config.ts apps/api/src/modules/models/routes.ts apps/api/test/integration/sample-videos-public.test.ts
git commit -m "$(cat <<'EOF'
feat(api): expose resolved pixverseVideoPricing on GET /v1/models/sample-videos

Extracts the merge-with-defaults logic already inside
getPixverseVideoCreditCost into its own exported
getPixverseVideoPricingConfig, then reuses it to add a
pixverseVideoPricing field to the sample-videos response. Lets the
Motion Studio Custom-mode UI (next task) compute a live cost preview
client-side via the already-exported pure computePixverseVideoCost,
without a new endpoint or a debounced round-trip. The server still
recomputes the charged cost itself at job-creation time regardless of
what the client showed.
EOF
)"
```

---

### Task 2: Custom (duration + quality) branch on `POST /v1/jobs/catalog-video`

**Files:**
- Modify: `packages/types/src/jobs.ts`
- Modify: `apps/api/src/modules/jobs/create.ts`
- Modify: `apps/api/test/integration/catalog-video-create.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateCatalogVideoJobRequest` now accepts either `{ sampleVideoId }` (unchanged) or `{ duration, quality }` (new) — Task 5 (frontend `page.tsx` submit handler) posts one of these two shapes to `POST /v1/jobs/catalog-video`. `PIXVERSE_CUSTOM_VIDEO_PROMPT` is exported from `@aivastra/types` for reference/tests but not needed by the frontend.

- [ ] **Step 1: Write the failing tests**

Open `apps/api/test/integration/catalog-video-create.test.ts` and add these `it()` blocks right before the file's final closing `});`:

```ts
  it('accepts a custom duration+quality request (no sampleVideoId), charges the formula cost, and snapshots the fixed prompt', async () => {
    const { token, userId } = await registerUser('cv-custom-happy@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 10, quality: '540p' },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    // Default pricing config: qualityBase=150 flat, perSecondRate=0 -> 150
    // regardless of duration/quality until an admin tunes it (same default
    // the preset-path formula tests above rely on).
    expect(job.creditsCharged).toBe(150);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.sampleVideoId).toBeNull();
    expect(params.duration).toBe(10);
    expect(params.quality).toBe('540p');
    expect(params.prompt).toBe(PIXVERSE_CUSTOM_VIDEO_PROMPT);
  });
  it('uses the admin-configured pricing formula for a custom request, not the hardcoded default', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 5,
          qualityBase: { '360p': 10, '540p': 20, '720p': 30, '1080p': 50 },
        },
      }),
    );
    try {
      const { token, userId } = await registerUser('cv-custom-tuned@x.com');
      await grantCredits(userId, 200);
      const sourceJobId = await sourceJob(userId);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/catalog-video',
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceJobId, duration: 10, quality: '540p' },
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = res.json();
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      // 20 (540p base) + 10s * 5/s = 70
      expect(job.creditsCharged).toBe(70);
    } finally {
      await app.redis.del('config:system');
    }
  });
  it('rejects duration outside 1-15 on a custom request', async () => {
    const { token, userId } = await registerUser('cv-custom-badduration@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 16, quality: '540p' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects an unrecognized quality on a custom request', async () => {
    const { token, userId } = await registerUser('cv-custom-badquality@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 8, quality: '4k' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects a request providing both sampleVideoId and duration/quality', async () => {
    const { token, userId } = await registerUser('cv-mixed@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId, duration: 8, quality: '540p' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects a request providing neither sampleVideoId nor a complete duration+quality pair', async () => {
    const { token, userId } = await registerUser('cv-custom-incomplete@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 8 },
    });
    expect(res.statusCode).toBe(400);
  });
```

Add the `PIXVERSE_CUSTOM_VIDEO_PROMPT` import at the top of the file (alongside the existing `import { schema } from '@aivastra/db';` line):

```ts
import { PIXVERSE_CUSTOM_VIDEO_PROMPT } from '@aivastra/types';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts catalog-video-create` (from `apps/api`)
Expected: FAIL — `PIXVERSE_CUSTOM_VIDEO_PROMPT` doesn't exist yet (import error) and/or the custom payload 400s as unrecognized shape.

- [ ] **Step 3: Add the constant and extend the schema in `packages/types/src/jobs.ts`**

Add this right after the existing `export interface PixverseVideoPricingConfig { ... }` block and before `computePixverseVideoCost`:

```ts
/**
 * Used for Motion Studio's Custom mode (duration + quality picked by the
 * end user, no prompt field) — see CreateCatalogVideoJobRequest. Written
 * once, deliberately generic and safe; not admin-configurable (YAGNI —
 * promote to a config value if that's ever requested).
 */
export const PIXVERSE_CUSTOM_VIDEO_PROMPT =
  'Subtle, natural motion: gentle fabric sway and a soft camera drift. ' +
  'Keep the face, body proportions, and garment details unchanged — no ' +
  'distortion, no extra people, no background changes.';
```

Then replace the existing `CreateCatalogVideoJobRequest`:

```ts
export const CreateCatalogVideoJobRequest = z
  .object({
    // Exactly one of sourceJobId (an existing completed AI Vastra job) or
    // sourceImageKey (a fresh upload of any image the caller owns — not
    // required to have been generated by AI Vastra) is required — enforced
    // below, same XOR style as upperGarmentKey/mannequinJobId above.
    sourceJobId: z.string().uuid().optional(),
    sourceImageKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    sampleVideoId: z.string().uuid(),
  })
  .refine((d) => Boolean(d.sourceJobId) !== Boolean(d.sourceImageKey), {
    message: 'Provide either sourceJobId or sourceImageKey, not both',
    path: ['sourceJobId'],
  });
```

with:

```ts
export const CreateCatalogVideoJobRequest = z
  .object({
    // Exactly one of sourceJobId (an existing completed AI Vastra job) or
    // sourceImageKey (a fresh upload of any image the caller owns — not
    // required to have been generated by AI Vastra) is required — enforced
    // below, same XOR style as upperGarmentKey/mannequinJobId above.
    sourceJobId: z.string().uuid().optional(),
    sourceImageKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    // Exactly one of sampleVideoId (an admin-curated prompt/duration/quality
    // preset) or duration+quality together (Motion Studio's Custom mode — no
    // prompt field; the server fills in PIXVERSE_CUSTOM_VIDEO_PROMPT) is
    // required — enforced by the two refine checks below.
    sampleVideoId: z.string().uuid().optional(),
    duration: z.number().int().min(PIXVERSE_DURATION_MIN).max(PIXVERSE_DURATION_MAX).optional(),
    quality: z.enum(PIXVERSE_QUALITIES).optional(),
  })
  .refine((d) => Boolean(d.sourceJobId) !== Boolean(d.sourceImageKey), {
    message: 'Provide either sourceJobId or sourceImageKey, not both',
    path: ['sourceJobId'],
  })
  .refine((d) => Boolean(d.sampleVideoId) !== Boolean(d.duration || d.quality), {
    message:
      'Provide either sampleVideoId, or duration and quality — not sampleVideoId together with duration/quality',
    path: ['sampleVideoId'],
  })
  .refine(
    (d) => d.sampleVideoId !== undefined || (d.duration !== undefined && d.quality !== undefined),
    {
      message: 'duration and quality must be provided together when sampleVideoId is omitted',
      path: ['duration'],
    },
  );
```

Note: `PIXVERSE_DURATION_MIN`, `PIXVERSE_DURATION_MAX`, and `PIXVERSE_QUALITIES` are already defined earlier in this same file (above `CreateSimpleTryonRequest`) — no new import needed.

- [ ] **Step 4: Branch `createCatalogVideoJob` in `apps/api/src/modules/jobs/create.ts`**

Add `PIXVERSE_CUSTOM_VIDEO_PROMPT` to the existing `@aivastra/types` import block:

```ts
import {
  ASPECT_DIMENSIONS,
  type CreateCatalogVideoJobRequest,
  type CreateSimpleTryonRequest,
  type CreateTryOnJobRequest,
  JOB_SOURCE,
  type JobSource,
  PIXVERSE_CUSTOM_VIDEO_PROMPT,
  type PixverseQuality,
  type Resolution,
  resolutionFromDims,
  type SareeStep2Inputs,
} from '@aivastra/types';
```

Then replace this block in `createCatalogVideoJob` (starts right after `resolvedSourceImageKey` is resolved — find it via the comment "Unreachable: CreateCatalogVideoJobRequest's XOR refine guarantees exactly / one of sourceJobId/sourceImageKey is present." a few lines above):

```ts
  const [sample] = await app.db
    .select()
    .from(schema.sampleVideos)
    .where(eq(schema.sampleVideos.id, body.sampleVideoId));
  if (!sample || sample.deletedAt) throw new AppError('NOT_FOUND', 404, 'sample video not found');
  if (!sample.isActive) throw new AppError('VALIDATION', 400, 'sample video is not active');
  const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');
  if (!isCatalogVideoAllowed(app.env, user.email)) {
    throw new AppError('FORBIDDEN', 403, 'catalog video is not enabled for this account');
  }
  // Priced by this specific sample video's own duration/quality — not a flat
  // cost — since PixVerse's real cost varies by both.
  const cost = await getPixverseVideoCreditCost(
    app,
    sample.duration,
    sample.quality as PixverseQuality,
  );
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        status: 'QUEUED',
        // Video jobs don't compete for GPU capacity, so the credit plan's queue tier
        // doesn't apply — they get their own lane instead (see VIDEO_QUEUE_STREAM).
        priority: false,
        queueStream: 'video',
        watermark: false,
        creditsCharged: cost,
        source: JOB_SOURCE.CATALOG_VIDEO,
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, cost, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      params: {
        kind: 'video',
        ...(body.sourceJobId ? { sourceJobId: body.sourceJobId } : {}),
        sourceImageKey: resolvedSourceImageKey,
        sampleVideoId: body.sampleVideoId,
        prompt: sample.prompt,
        // Snapshotted at creation time — same immutable-input pattern as
        // `prompt` above — so the dispatcher forwards exactly what this job
        // was priced and created with, even if the template is edited later.
        duration: sample.duration,
        quality: sample.quality,
      },
    });
    return [newJob];
  });
```

with:

```ts
  const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');
  if (!isCatalogVideoAllowed(app.env, user.email)) {
    throw new AppError('FORBIDDEN', 403, 'catalog video is not enabled for this account');
  }

  // Exactly one of sampleVideoId or (duration + quality) is present —
  // enforced by CreateCatalogVideoJobRequest's refine checks. sampleVideoId
  // reuses an admin-curated prompt/duration/quality combo; the custom path
  // (Motion Studio's Custom mode) lets the caller pick duration/quality
  // directly, with a fixed system prompt — no free-text prompt from end
  // users.
  let prompt: string;
  let duration: number;
  let quality: PixverseQuality;
  let sampleVideoId: string | null;
  if (body.sampleVideoId) {
    const [sample] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, body.sampleVideoId));
    if (!sample || sample.deletedAt)
      throw new AppError('NOT_FOUND', 404, 'sample video not found');
    if (!sample.isActive) throw new AppError('VALIDATION', 400, 'sample video is not active');
    prompt = sample.prompt;
    duration = sample.duration;
    quality = sample.quality as PixverseQuality;
    sampleVideoId = body.sampleVideoId;
  } else {
    // Unreachable per the schema's refine checks — guarded here so
    // TypeScript sees duration/quality as definitely assigned below.
    if (body.duration === undefined || body.quality === undefined) {
      throw new AppError('VALIDATION', 400, 'duration and quality are required');
    }
    prompt = PIXVERSE_CUSTOM_VIDEO_PROMPT;
    duration = body.duration;
    quality = body.quality;
    sampleVideoId = null;
  }
  // Priced by this job's own duration/quality — not a flat cost — since
  // PixVerse's real cost varies by both, for presets and custom alike.
  const cost = await getPixverseVideoCreditCost(app, duration, quality);
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        status: 'QUEUED',
        // Video jobs don't compete for GPU capacity, so the credit plan's queue tier
        // doesn't apply — they get their own lane instead (see VIDEO_QUEUE_STREAM).
        priority: false,
        queueStream: 'video',
        watermark: false,
        creditsCharged: cost,
        source: JOB_SOURCE.CATALOG_VIDEO,
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, cost, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      params: {
        kind: 'video',
        ...(body.sourceJobId ? { sourceJobId: body.sourceJobId } : {}),
        sourceImageKey: resolvedSourceImageKey,
        sampleVideoId,
        prompt,
        // Snapshotted at creation time — same immutable-input pattern the
        // preset path already had — so the dispatcher forwards exactly what
        // this job was priced and created with.
        duration,
        quality,
      },
    });
    return [newJob];
  });
```

Everything after this block (the `redis.xadd` / refund-on-failure logic) is unchanged — do not modify it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts catalog-video-create` (from `apps/api`)
Expected: PASS, every test in the file (existing preset-path tests plus the 6 new ones).

- [ ] **Step 6: Run the access-gate test too**

Run: `npx vitest run --config vitest.integration.config.ts catalog-video-access-gate` (from `apps/api`)
Expected: PASS — confirms the reordered banned/`isCatalogVideoAllowed` checks still gate correctly for the preset path.

- [ ] **Step 7: Typecheck both packages**

Run: `pnpm --filter @aivastra/types typecheck && pnpm --filter @aivastra/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/jobs.ts apps/api/src/modules/jobs/create.ts apps/api/test/integration/catalog-video-create.test.ts
git commit -m "$(cat <<'EOF'
feat(api): custom duration+quality branch on POST /v1/jobs/catalog-video

CreateCatalogVideoJobRequest now accepts either sampleVideoId (an
admin-curated preset, unchanged) or duration+quality together (Motion
Studio's new Custom mode) — enforced by the same XOR-via-refine style
the file already uses for sourceJobId/sourceImageKey. No prompt field
for the custom path; the server fills in a fixed constant
(PIXVERSE_CUSTOM_VIDEO_PROMPT). Priced by the same
getPixverseVideoCreditCost formula presets already use. No dispatcher
change — processVideoJob already reads prompt/duration/quality
generically off job_inputs.params.
EOF
)"
```

---

### Task 3: `types.ts` + `SourcePanel` "chosen" preview state

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/catalog-video/types.ts`
- Modify: `apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`
- Modify: `apps/catalogues-web/src/app/(app)/catalog-video/SourcePanel.tsx`

**Interfaces:**
- Consumes: `JobThumbnail` from `./JobThumbnail.tsx` (already exists).
- Produces: `ImageSource` type exported from `./types.ts` — Task 4 (`ConfigPanel.tsx`) and Task 5 (`page.tsx` rewiring) both import it from here, not from `CatalogVideoWizard.tsx`. `SourcePanel` gains two new required props: `source: ImageSource | null` and `onRemove: () => void`.

- [ ] **Step 1: Create `types.ts`**

```ts
// The two ways a video can be sourced: an existing completed AI Vastra job
// (from the catalogues grid), or a fresh upload of any image the user owns —
// not required to have been generated by AI Vastra at all. Shared by
// page.tsx, SourcePanel.tsx, and ConfigPanel.tsx.
export type ImageSource =
  | { kind: 'existing'; jobId: string }
  | { kind: 'upload'; r2Key: string; previewUrl: string };
```

Save as `apps/catalogues-web/src/app/(app)/catalog-video/types.ts`.

`CatalogVideoWizard.tsx` keeps its own separately-declared (structurally
identical) `ImageSource` export for now — it's deleted in Task 5, not worth
editing in the meantime. TypeScript's structural typing accepts either type
wherever the other is expected, so this causes no type errors.

- [ ] **Step 2: Point `page.tsx`'s `ImageSource` import at the new file**

In `apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`, change:

```ts
import { CataloguePickerModal } from './CataloguePickerModal';
import { CatalogVideoWizard, type ImageSource } from './CatalogVideoWizard';
import { SourcePanel } from './SourcePanel';
```

to:

```ts
import { CataloguePickerModal } from './CataloguePickerModal';
import { CatalogVideoWizard } from './CatalogVideoWizard';
import { SourcePanel } from './SourcePanel';
import type { ImageSource } from './types';
```

Nothing else in `page.tsx` changes in this task — the `CatalogVideoWizard` render block, `wizardSource` state, etc. stay exactly as they are; Task 5 rewires them.

- [ ] **Step 3: Add the "chosen" preview state to `SourcePanel.tsx`**

Full replacement for `apps/catalogues-web/src/app/(app)/catalog-video/SourcePanel.tsx`:

```tsx
'use client';

import { ImagePlus, Images, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { JobThumbnail } from './JobThumbnail';
import type { ImageSource } from './types';

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
};

// Left half of the Motion Studio main screen (mirrors Studio's two-column
// layout: source input on the left, output preview on the right). Two ways
// to pick a source image: "Browse Catalogues" opens CataloguePickerModal to
// reuse a past completed generation; "Upload Custom Image" (or dragging a
// file onto the card, or clicking the card itself) uploads a fresh photo.
// Once `source` is set, the empty-state prompt is replaced by a preview of
// the chosen image with a "Change image" control — same
// preview-with-remove-button pattern CatalogVideoWizard's UploadDropzone
// already uses, so picking a source has a visible result instead of the
// card silently staying the same.
export function SourcePanel({
  source,
  onFile,
  onBrowseCatalogues,
  onRemove,
  uploading,
  progress,
  error,
}: {
  source: ImageSource | null;
  onFile: (file: File) => void;
  onBrowseCatalogues: () => void;
  onRemove: () => void;
  uploading: boolean;
  progress: number;
  error: string | null;
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function browse() {
    if (!uploading) inputRef.current?.click();
  }

  if (source && !uploading) {
    return (
      <div style={{ ...CARD_STYLE, position: 'relative', overflow: 'hidden' }}>
        {source.kind === 'existing' ? (
          <JobThumbnail jobId={source.jobId} alt="Selected source image" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          // biome-ignore lint/performance/noImgElement: local blob URL preview
          <img
            src={source.previewUrl}
            alt="Selected source image"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        <button
          type="button"
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'rgba(0,0,0,0.55)',
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <X size={14} />
          Change image
        </button>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop surface backing a real <input type=file>; the two buttons and the input itself remain independently keyboard-accessible
    // biome-ignore lint/a11y/useKeyWithClickEvents: same reasoning — the file input and the two buttons below are the keyboard-operable controls
    <div
      onClick={browse}
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file && !uploading) onFile(file);
      }}
      style={{
        ...CARD_STYLE,
        boxShadow: `inset 0 0 0 1.5px ${dragOver ? C.pink : C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 40,
        textAlign: 'center',
        cursor: uploading ? 'not-allowed' : 'pointer',
        transition: 'box-shadow 150ms ease',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={uploading}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: dragOver ? 'rgba(245,92,122,0.16)' : 'rgba(245,92,122,0.1)',
          display: 'grid',
          placeItems: 'center',
          color: C.pink,
          transition: 'background 150ms ease',
        }}
      >
        <ImagePlus size={28} strokeWidth={1.5} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>
          Animate Your Fashion
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: C.mid, maxWidth: 320, lineHeight: 1.5 }}>
          Drag and Drop your image here, Or click the button below to upload
        </p>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <GradBtn
          outline
          disabled={uploading}
          onClick={(event) => {
            // Stop the click from also bubbling to the card's own onClick —
            // without this the card handler would fire too and open the
            // file dialog on top of the catalogue picker.
            event.stopPropagation();
            onBrowseCatalogues();
          }}
        >
          <Images size={16} />
          Browse Catalogues
        </GradBtn>
        <GradBtn
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            browse();
          }}
        >
          <Upload size={16} />
          Upload Custom Image
        </GradBtn>
      </div>
      {uploading && <p style={{ margin: 0, fontSize: 12, color: C.mid }}>Uploading… {progress}%</p>}
      {error && !uploading && <p style={{ margin: 0, fontSize: 12, color: '#D63B4C' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Update `page.tsx`'s `<SourcePanel>` usage to pass the two new props**

In `apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`, change:

```tsx
            <SourcePanel
              onFile={handleUpload}
              onBrowseCatalogues={() => setPickerOpen(true)}
              uploading={uploading}
              progress={uploadProgress}
              error={uploadError}
            />
```

to:

```tsx
            <SourcePanel
              source={wizardSource}
              onFile={handleUpload}
              onBrowseCatalogues={() => setPickerOpen(true)}
              onRemove={() => setWizardSource(null)}
              uploading={uploading}
              progress={uploadProgress}
              error={uploadError}
            />
```

(`wizardSource`/`setWizardSource` are renamed to `source`/`setSource` in Task 5, along with the rest of the rewiring — this task only needs `SourcePanel` to compile and behave correctly against the current, still-`wizardSource`-named state.)

- [ ] **Step 5: Typecheck and build**

Run: `pnpm --filter @aivastra/web typecheck`
Expected: no errors.

Run: `pnpm --filter @aivastra/web build`
Expected: succeeds, `/catalog-video` route compiles.

- [ ] **Step 6: Lint**

Run: `cd apps/catalogues-web && npx biome check "src/app/(app)/catalog-video/" "src/app/(app)/catalog-video/types.ts"`
Expected: no errors. If formatting-only diagnostics appear, fix with `npx biome check --write` on the flagged file(s) and re-run.

- [ ] **Step 7: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/catalog-video/types.ts" "apps/catalogues-web/src/app/(app)/catalog-video/page.tsx" "apps/catalogues-web/src/app/(app)/catalog-video/SourcePanel.tsx"
git commit -m "$(cat <<'EOF'
feat(web): SourcePanel shows the chosen image, ImageSource moves to types.ts

SourcePanel now takes the current source and an onRemove callback —
once a source is picked (upload or catalogue image), it shows that
image with a "Change image" control instead of silently staying on
the empty drag-and-drop prompt. ImageSource moves out of
CatalogVideoWizard.tsx into its own types.ts so ConfigPanel (next
task) and page.tsx's post-wizard rewiring (Task 5) don't have to
import a type from a component file that's about to be deleted.
EOF
)"
```

---

### Task 4: `ConfigPanel.tsx`

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/catalog-video/ConfigPanel.tsx`

**Interfaces:**
- Consumes: `ImageSource` from `./types`, `JobThumbnail` from `./JobThumbnail`, `PIXVERSE_QUALITIES`/`PIXVERSE_DURATION_MIN`/`PIXVERSE_DURATION_MAX`/`computePixverseVideoCost`/`type PixverseQuality`/`type PixverseVideoPricingConfig` from `@aivastra/types`.
- Produces: `ConfigPanel` component — Task 5 wires it into `page.tsx`'s right column, replacing the current placeholder `<div>`. Its `onSubmit` prop is called with either `{ sampleVideoId: string }` or `{ duration: number; quality: PixverseQuality }`, matching exactly the two shapes `CreateCatalogVideoJobRequest` (Task 2) now accepts.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  computePixverseVideoCost,
  PIXVERSE_DURATION_MAX,
  PIXVERSE_DURATION_MIN,
  PIXVERSE_QUALITIES,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
} from '@aivastra/types';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { JobThumbnail } from './JobThumbnail';
import type { ImageSource } from './types';

interface SampleVideoOption {
  id: string;
  title: string;
  thumbnailUrl: string;
  previewVideoUrl: string;
  creditCost: number;
}

interface SampleVideosResponse {
  items: SampleVideoOption[];
  pixverseVideoPricing: PixverseVideoPricingConfig;
}

type Choice = { sampleVideoId: string } | { duration: number; quality: PixverseQuality };

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

// Right half of the Motion Studio main screen. Two internal steps ("select"
// then "review") sit on top of a Preset/Custom mode choice — Preset reuses
// the admin-curated sample_videos catalogue (same grid CatalogVideoWizard's
// step 2 had); Custom lets the caller pick duration + quality directly, no
// prompt field (the server fills one in — see PIXVERSE_CUSTOM_VIDEO_PROMPT
// in packages/types). Disabled (no mode toggle at all) until a source image
// is chosen on the left.
export function ConfigPanel({
  source,
  submitting,
  submitError,
  onSubmit,
}: {
  source: ImageSource | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (choice: Choice) => void;
}): React.ReactElement {
  const [configStep, setConfigStep] = useState<'select' | 'review'>('select');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [sampleVideoId, setSampleVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<PixverseQuality>('720p');

  // Identity key for the current source — a plain object-reference check
  // would also fire on every re-render of an unrelated parent state change
  // if `source` were ever recreated with the same values, so key on the
  // field that actually identifies it.
  const sourceKey = source ? (source.kind === 'existing' ? source.jobId : source.r2Key) : null;
  // Changing (or clearing) the source image invalidates whatever config step
  // the user was on — jumping Review's "Generate" straight from a stale
  // source would generate a video for the wrong photo.
  useEffect(() => {
    setConfigStep('select');
  }, [sourceKey]);

  const { data: sampleVideos, isLoading: sampleVideosLoading } = useQuery<SampleVideosResponse>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
    enabled: source !== null,
  });

  const { data: creditsData } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
    enabled: source !== null,
  });

  const balance = creditsData?.balance;
  const pricing = sampleVideos?.pixverseVideoPricing;
  const selectedSample = sampleVideos?.items.find((option) => option.id === sampleVideoId);
  const customCost = pricing ? computePixverseVideoCost(duration, quality, pricing) : undefined;
  const cost = mode === 'preset' ? selectedSample?.creditCost : customCost;
  const insufficientCredits =
    typeof cost === 'number' && typeof balance === 'number' && balance < cost;
  const continueDisabled = mode === 'preset' ? !sampleVideoId : typeof customCost !== 'number';

  function handleGenerate() {
    if (insufficientCredits || submitting) return;
    if (mode === 'preset' && sampleVideoId) onSubmit({ sampleVideoId });
    else if (mode === 'custom') onSubmit({ duration, quality });
  }

  if (!source) {
    return (
      <div
        style={{
          ...CARD_STYLE,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 40,
          textAlign: 'center',
          color: C.mid,
        }}
      >
        <SlidersHorizontal size={28} strokeWidth={1.5} />
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
          Choose a source image to continue
        </span>
        <span style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
          Upload or browse a catalogue image on the left, then configure your video here.
        </span>
      </div>
    );
  }

  return (
    <div style={CARD_STYLE}>
      <style>{`
        .config-panel-mode-toggle button {
          padding: 8px 16px;
          border-radius: 999;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .config-panel-preset-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        }
        .config-panel-review-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 639px) {
          .config-panel-review-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div
        style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${C.border}`,
          fontSize: 16,
          fontWeight: 700,
          color: C.text,
        }}
      >
        {configStep === 'select' ? 'Configure your video' : 'Review & generate'}
      </div>

      <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {configStep === 'select' ? (
          <>
            <div className="config-panel-mode-toggle" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['preset', 'custom'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  style={{
                    border: `1px solid ${mode === m ? C.pink : C.border}`,
                    background: mode === m ? 'rgba(245,92,122,0.08)' : 'transparent',
                    color: mode === m ? C.pink : C.mid,
                  }}
                >
                  {m === 'preset' ? 'Preset' : 'Custom'}
                </button>
              ))}
            </div>

            {mode === 'preset' ? (
              sampleVideosLoading ? (
                <p style={{ color: C.mid, fontSize: 13 }}>Loading motion templates...</p>
              ) : (sampleVideos?.items.length ?? 0) === 0 ? (
                <p style={{ color: C.mid, fontSize: 13 }}>No video templates are available.</p>
              ) : (
                <div className="config-panel-preset-grid">
                  {(sampleVideos?.items ?? []).map((option) => {
                    const selected = option.id === sampleVideoId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSampleVideoId(option.id)}
                        style={{
                          position: 'relative',
                          padding: 0,
                          textAlign: 'left',
                          overflow: 'hidden',
                          border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                          borderRadius: 8,
                          background: C.card,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ aspectRatio: '9 / 16', background: C.lighter }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {/* biome-ignore lint/performance/noImgElement: animated GIF preview, presigned R2 URL */}
                          <img
                            src={option.thumbnailUrl}
                            alt={option.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </div>
                        <span
                          style={{
                            display: 'block',
                            padding: '10px 12px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: C.text,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {option.title}
                        </span>
                        <span style={{ display: 'block', padding: '0 12px 10px', fontSize: 11, color: C.mid }}>
                          {option.creditCost} credits
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    Duration (seconds)
                  </label>
                  <input
                    type="number"
                    min={PIXVERSE_DURATION_MIN}
                    max={PIXVERSE_DURATION_MAX}
                    value={duration}
                    onChange={(event) =>
                      setDuration(
                        Math.min(
                          PIXVERSE_DURATION_MAX,
                          Math.max(PIXVERSE_DURATION_MIN, Number(event.target.value)),
                        ),
                      )
                    }
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      fontSize: 14,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Quality</label>
                  <select
                    value={quality}
                    onChange={(event) => setQuality(event.target.value as PixverseQuality)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      fontSize: 14,
                    }}
                  >
                    {PIXVERSE_QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
                {typeof customCost === 'number' && (
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.mid }}>
                    {customCost} credits
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="config-panel-review-grid">
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                {source.kind === 'existing' ? (
                  <JobThumbnail jobId={source.jobId} alt="Selected source" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: local blob URL preview
                  <img
                    src={source.previewUrl}
                    alt="Selected source"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
              <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                {source.kind === 'upload' ? 'Uploaded image' : 'Catalogue image'}
              </div>
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                {mode === 'preset' && selectedSample && (
                  <video
                    src={selectedSample.previewVideoUrl}
                    poster={selectedSample.thumbnailUrl}
                    muted
                    controls
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                {mode === 'custom' && (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      color: C.mid,
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {duration}s · {quality}
                  </div>
                )}
              </div>
              <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                {mode === 'preset' ? (selectedSample?.title ?? 'Motion template') : 'Custom configuration'}
              </div>
            </div>
            {typeof cost === 'number' && (
              <p
                style={{
                  gridColumn: '1 / -1',
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: insufficientCredits ? '#D63B4C' : C.mid,
                }}
              >
                {cost} credits required
                {typeof balance === 'number' ? ` — you have ${balance} credits` : ''}
                {insufficientCredits ? '. Top up to generate a video.' : ''}
              </p>
            )}
            {submitError && (
              <p style={{ gridColumn: '1 / -1', margin: 0, color: '#D63B4C', fontSize: 13 }}>
                {submitError}
              </p>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {configStep === 'review' ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfigStep('select')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'transparent',
              color: C.mid,
              padding: 8,
              fontSize: 13,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            <ChevronLeft size={16} />
            Back
          </button>
        ) : (
          <span />
        )}
        {configStep === 'select' ? (
          <GradBtn disabled={continueDisabled} onClick={() => setConfigStep('review')}>
            Continue
          </GradBtn>
        ) : (
          <Tooltip
            tip={
              insufficientCredits
                ? `You need ${cost} credits and have ${balance}. Top up to continue.`
                : undefined
            }
          >
            <GradBtn disabled={submitting || insufficientCredits} onClick={handleGenerate}>
              {submitting ? 'Starting...' : 'Generate video'}
            </GradBtn>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @aivastra/web typecheck`
Expected: no errors. (The component isn't imported anywhere yet — this only checks the file compiles on its own.)

- [ ] **Step 3: Lint**

Run: `cd apps/catalogues-web && npx biome check "src/app/(app)/catalog-video/ConfigPanel.tsx"`
Expected: no errors. If formatting-only diagnostics appear, fix with `npx biome check --write` and re-run. If a `border-radius: 999;` warning appears (missing unit — CSS-in-template-string isn't linted by biome, so this is a manual check, not a biome one): fix it to `border-radius: 999px;` in the `.config-panel-mode-toggle button` rule.

- [ ] **Step 4: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/catalog-video/ConfigPanel.tsx"
git commit -m "$(cat <<'EOF'
feat(web): add ConfigPanel — Motion Studio's preset/custom config + review step

New right-column component: Preset (admin-curated sample_videos, same
grid CatalogVideoWizard's step 2 had) or Custom (duration + quality,
no prompt field — cost computed client-side via the pure
computePixverseVideoCost against the pixverseVideoPricing field the
sample-videos endpoint now returns). Continue advances to a review
step (source + config + cost) before the actual Generate button, per
spec. Not wired into page.tsx yet — next task.
EOF
)"
```

---

### Task 5: Wire `ConfigPanel` into `page.tsx`, delete `CatalogVideoWizard`

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`
- Delete: `apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx`

**Interfaces:**
- Consumes: `ConfigPanel` from `./ConfigPanel` (Task 4), `SourcePanel`'s `source`/`onRemove` props (Task 3).
- Produces: nothing later tasks depend on — this is the plan's final task.

- [ ] **Step 1: Rewrite `page.tsx`**

Full replacement for `apps/catalogues-web/src/app/(app)/catalog-video/page.tsx`:

```tsx
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PixverseQuality } from '@aivastra/types';
import { Film } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { isSupportedImageBytes } from '@/lib/image-validation';

import { CataloguePickerModal } from './CataloguePickerModal';
import { ConfigPanel } from './ConfigPanel';
import { SourcePanel } from './SourcePanel';
import type { ImageSource } from './types';

interface CatalogVideoItem {
  id: string;
  status: string;
  createdAt: string;
  sampleVideoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

function statusColor(status: string): string {
  if (status === 'COMPLETED') return C.mint;
  if (status === 'FAILED' || status === 'CANCELLED') return C.pink;
  return C.amber;
}

/** The dispatcher's raw statuses are internal pipeline stages — collapse the three
 *  in-flight ones into a single "Generating" so the pill reads as progress. */
function statusLabel(status: string): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued';
    case 'PREPROCESSING':
    case 'GENERATING':
    case 'UPLOADING':
      return 'Generating';
    case 'COMPLETED':
      return 'Ready';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

export default function CatalogVideoPage(): React.ReactElement {
  const qc = useQueryClient();
  const [source, setSource] = useState<ImageSource | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: items, isLoading } = useQuery<CatalogVideoItem[]>({
    queryKey: ['catalog-videos'],
    queryFn: () => api.get('/v1/catalog-videos'),
    refetchInterval: 5 * 60 * 1000,
  });

  useJobStream(
    useCallback(
      (event) => {
        qc.setQueryData<CatalogVideoItem[]>(['catalog-videos'], (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.id === event.jobId ? { ...item, status: event.status } : item,
          );
        });
        if (event.status === 'COMPLETED') {
          void qc.invalidateQueries({ queryKey: ['catalog-videos'] });
        }
      },
      [qc],
    ),
  );

  // Abort any in-flight upload on unmount.
  useEffect(() => {
    return () => uploadAbortRef.current?.abort();
  }, []);

  // Revoke the previous upload's blob URL whenever `source` changes away
  // from it (a new upload, switching to a catalogue image, clearing on
  // submit, or unmount) — never the currently active one. Same pattern
  // CatalogVideoWizard used to own before `source` moved up to this page.
  useEffect(() => {
    return () => {
      if (source?.kind === 'upload') URL.revokeObjectURL(source.previewUrl);
    };
  }, [source]);

  async function handleUpload(file: File) {
    if (uploading) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File exceeds 10 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      setUploadError('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    const previewUrl = URL.createObjectURL(file);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, setUploadProgress, abort.signal);
      setSource({ kind: 'upload', r2Key, previewUrl });
    } catch (e) {
      URL.revokeObjectURL(previewUrl);
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : '';
      setUploadError(
        msg.includes('403')
          ? 'Upload session expired. Please re-upload your image and try again.'
          : `Upload failed: ${msg}`,
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerate(
    choice: { sampleVideoId: string } | { duration: number; quality: PixverseQuality },
  ) {
    if (!source || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post('/v1/jobs/catalog-video', {
        ...(source.kind === 'existing'
          ? { sourceJobId: source.jobId }
          : { sourceImageKey: source.r2Key }),
        ...choice,
      });
      await qc.invalidateQueries({ queryKey: ['catalog-videos'] });
      // Back to the empty state on both panels — nothing left to configure
      // once the job is queued.
      setSource(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start video generation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        .cat-video-main {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 20px 24px 32px;
          background: ${C.bg};
          box-sizing: border-box;
        }

        .cat-video-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .cat-video-title {
          margin: 0;
          color: ${C.text};
          font-size: 20px;
        }

        .cat-video-subtitle {
          margin: 5px 0 0;
          color: ${C.mid};
          font-size: 13px;
        }

        .cat-video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
        }

        /* Main creation surface: source (left) + config (right), same split
           as Studio's studio-left-column / studio-right-column. min-height
           fills the full viewport under the 76px TopBar (minus this
           section's own share of .cat-video-main's padding) so both columns
           stand as tall as the screen — "Your Videos" below is reachable by
           scrolling further, not squeezed into the same screen. */
        .cat-video-two-col {
          display: flex;
          gap: 20px;
          margin-bottom: 28px;
          min-height: calc(100vh - 76px - 20px - 32px);
        }
        .cat-video-source-col,
        .cat-video-result-col {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
        }

        @media (max-width: 1023px) {
          .cat-video-main {
            padding: 16px 20px 24px;
          }
          .cat-video-grid {
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
          }
          .cat-video-two-col {
            flex-direction: column;
            min-height: calc(100vh - 76px - 16px - 24px);
          }
        }

        @media (max-width: 639px) {
          .cat-video-main {
            padding: 12px 16px 20px;
          }
          .cat-video-two-col {
            min-height: calc(100vh - 76px - 12px - 20px);
          }
          .cat-video-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 12px;
          }
          .cat-video-title {
            font-size: 18px;
          }
          .cat-video-subtitle {
            font-size: 12px;
          }
          .cat-video-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
        }
      `}</style>
      <TopBar
        title="Motion Studio"
        subtitle="Animate a catalogue photo into a motion-ready product video"
      />
      <main className="cat-video-main">
        <div className="cat-video-two-col">
          <div className="cat-video-source-col">
            <SourcePanel
              source={source}
              onFile={handleUpload}
              onBrowseCatalogues={() => setPickerOpen(true)}
              onRemove={() => setSource(null)}
              uploading={uploading}
              progress={uploadProgress}
              error={uploadError}
            />
          </div>
          <div className="cat-video-result-col">
            <ConfigPanel
              source={source}
              submitting={submitting}
              submitError={submitError}
              onSubmit={handleGenerate}
            />
          </div>
        </div>

        <div className="cat-video-header">
          <div>
            <h1 className="cat-video-title">Your Videos</h1>
            <p className="cat-video-subtitle">Your generated product videos</p>
          </div>
        </div>

        {isLoading ? (
          <p style={{ color: C.mid, fontSize: 13 }}>Loading videos...</p>
        ) : !items || items.length === 0 ? (
          <div
            style={{
              minHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              color: C.mid,
            }}
          >
            <Film size={28} strokeWidth={1.5} />
            <span style={{ fontSize: 13 }}>No catalog videos yet.</span>
          </div>
        ) : (
          <div className="cat-video-grid">
            {items.map((item) => {
              const color = statusColor(item.status);
              return (
                <article
                  key={item.id}
                  className="prod-card"
                  style={{
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    borderRadius: 14,
                    background: C.card,
                  }}
                >
                  <div
                    className="prod-card-img"
                    style={{
                      position: 'relative',
                      aspectRatio: '9 / 16',
                      background: C.lighter,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {item.status === 'COMPLETED' && item.videoUrl ? (
                      // biome-ignore lint/a11y/useMediaCaption: silent garment-preview clip, no dialogue/narration
                      <video
                        src={item.videoUrl}
                        poster={item.thumbnailUrl ?? undefined}
                        controls
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      // biome-ignore lint/performance/noImgElement: presigned R2 URL
                      <img
                        src={item.thumbnailUrl}
                        alt="Catalog video preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Film size={24} color={C.mid} strokeWidth={1.5} />
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '10px 14px',
                    }}
                  >
                    <span
                      style={{
                        color,
                        background: `color-mix(in srgb, ${color} 12%, transparent)`,
                        borderRadius: 20,
                        padding: '2px 7px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {statusLabel(item.status)}
                    </span>
                    <time style={{ color: C.light, fontSize: 12 }} dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {pickerOpen && (
        <CataloguePickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={(jobId) => {
            setPickerOpen(false);
            setSource({ kind: 'existing', jobId });
          }}
        />
      )}
    </>
  );
}
```

Key differences from the current file: `wizardSource`/`setWizardSource` renamed to `source`/`setSource`; the blob-URL-revocation `useEffect` (previously owned by `CatalogVideoWizard`) is now here; `handleGenerate` replaces the wizard's `handleSubmit`; the `<ConfigPanel>` render replaces the old placeholder `<div>`; the `{wizardSource && <CatalogVideoWizard .../>}` block at the bottom is gone entirely.

- [ ] **Step 2: Delete `CatalogVideoWizard.tsx`**

```bash
rm "apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx"
```

- [ ] **Step 3: Confirm nothing else imports it**

```bash
grep -r "CatalogVideoWizard" apps/catalogues-web/src
```
Expected: no matches (the `Tooltip`/`Check`/`grad` imports it used are still used elsewhere in the app — this only confirms the wizard file itself has no remaining references).

- [ ] **Step 4: Typecheck and build**

Run: `pnpm --filter @aivastra/web typecheck`
Expected: no errors.

Run: `pnpm --filter @aivastra/web build`
Expected: succeeds, `/catalog-video` route compiles.

- [ ] **Step 5: Lint**

Run: `cd apps/catalogues-web && npx biome check "src/app/(app)/catalog-video/"`
Expected: no errors (the deleted file is gone from the directory, so it isn't linted). Fix any formatting-only diagnostics with `npx biome check --write` and re-run.

- [ ] **Step 6: Manual smoke check**

Run `pnpm --filter @aivastra/web dev`, open `/catalog-video`, and walk through: upload an image (or browse catalogues) → SourcePanel shows the chosen preview → ConfigPanel's Preset tab shows the sample-video grid, Custom tab shows duration/quality with a live cost → Continue → Review shows the source thumbnail + chosen config + cost → Generate → the page returns to the empty state on both panels and the new job appears (as "Queued"/"Generating") in "Your Videos" below.

- [ ] **Step 7: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/catalog-video/page.tsx"
git rm "apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx"
git commit -m "$(cat <<'EOF'
feat(web): wire ConfigPanel into Motion Studio, delete the modal wizard

page.tsx's `source` state (renamed from `wizardSource`) now drives
both SourcePanel and ConfigPanel directly — no more modal in between.
Generate posts either { sampleVideoId } or { duration, quality } to
POST /v1/jobs/catalog-video depending on which mode ConfigPanel's
review step was showing. CatalogVideoWizard.tsx has no remaining
callers and is deleted, completing the "replace the modal wizard"
direction from the SourcePanel/CataloguePickerModal work earlier this
branch.
EOF
)"
```

---

## Final verification (after all 5 tasks)

- [ ] `pnpm --filter @aivastra/types typecheck && pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/web typecheck`
- [ ] `npx vitest run --config vitest.integration.config.ts catalog-video-create catalog-video-access-gate sample-videos-public catalog-videos-list catalogues-exclude-mannequin` (from `apps/api` — the full set of integration files this plan's changes touch or share a route with)
- [ ] `pnpm --filter @aivastra/web build`
- [ ] `pnpm --filter @aivastra/api lint && pnpm --filter @aivastra/web lint`

# PixVerse Dynamic Duration & Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `duration: 8, quality: '720p'` sent to PixVerse's
image-to-video API with per-sample-video-template values (duration 1–15s,
quality 360p/540p/720p/1080p), priced via an admin-configurable formula
instead of one flat credit cost.

**Architecture:** `sample_videos` (the admin-curated animation-template table)
gains `duration`/`quality` columns. A pure formula function
(`computePixverseVideoCost`) in `packages/types` turns
`(duration, quality, adminPricingConfig)` into a credit cost; both the API
resolver and the admin cost-preview UI call the same function so they can't
drift. `job_inputs.params` snapshots the chosen template's duration/quality at
job-creation time (same pattern the existing `prompt` field already uses), so
the dispatcher never re-looks-up the template — it just forwards what's on the
job.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM (Postgres), Zod, React
(admin-web: Vite SPA; catalogues-web: Next.js), Vitest.

## Global Constraints

- PixVerse v6 (the hardcoded `model` value — out of scope to change) accepts
  `duration` as any integer `1–15` and `quality` as `'360p' | '540p' | '720p' | '1080p'`,
  with no cross-constraint between them. Source: PixVerse's own OpenAPI spec
  text, quoted in the design doc.
- No schema or migration work runs against production — this repo's
  CLAUDE.md "Production safety" rule. Every step below runs against the local
  `pnpm docker:up` Postgres.
- `packages/db/src/index.ts` exports `* as schema` — never add a duplicate
  `schema` re-export.
- Import `@aivastra/db` / `@aivastra/types` as `workspace:*`, never by
  relative path into `packages/`.
- `apps/admin-mobile` is out of scope — do not touch it.
- Full design context: `docs/superpowers/specs/2026-08-25-pixverse-dynamic-duration-quality-design.md`.

---

### Task 1: `sample_videos` gains `duration`/`quality` columns

**Files:**
- Modify: `packages/db/src/schema/models.ts:84-95` (the `sampleVideos` table)
- Create: `packages/db/src/migrations/<next>_*.sql` (generated, not hand-written)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `schema.sampleVideos.duration: integer` (not null, default `8`),
  `schema.sampleVideos.quality: text` (not null, default `'720p'`), both
  insertable/selectable via `app.db.insert/select(schema.sampleVideos)`
  everywhere downstream.

- [ ] **Step 1: Edit the schema**

Replace the `sampleVideos` table definition in
`packages/db/src/schema/models.ts` (currently a 2-argument `pgTable` call)
with a 3-argument version that adds the two columns and two `CHECK`
constraints:

```typescript
import { sql } from 'drizzle-orm';
import {
  boolean,
  check, // add this import
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
```

```typescript
export const sampleVideos = pgTable(
  'sample_videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    videoR2Key: text('video_r2_key').notNull(),
    thumbnailR2Key: text('thumbnail_r2_key').notNull(),
    prompt: text('prompt').notNull(),
    // PixVerse image-to-video params for this template. v6 (the hardcoded
    // model) accepts duration 1-15s at any of 4 quality tiers with no
    // cross-constraint — see docs/superpowers/specs/
    // 2026-08-25-pixverse-dynamic-duration-quality-design.md.
    duration: integer('duration').notNull().default(8),
    quality: text('quality').notNull().default('720p'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sample_videos_duration_valid', sql`${t.duration} BETWEEN 1 AND 15`),
    check(
      'sample_videos_quality_valid',
      sql`${t.quality} IN ('360p', '540p', '720p', '1080p')`,
    ),
  ],
);
```

The defaults (`8`, `'720p'`) match today's hardcoded PixVerse call exactly —
existing rows keep behaving identically until an admin edits them.

- [ ] **Step 2: Generate the migration**

Run from the repo root:

```bash
pnpm db:generate
```

This introspects the schema diff and writes a new
`packages/db/src/migrations/NNNN_<random-name>.sql` (next number after the
current highest, `0171`) plus its matching `meta/NNNN_snapshot.json` and a
`meta/_journal.json` entry — do not hand-edit any of those three files
beyond what's shown next.

Expected SQL content (exact wording may vary slightly, but must contain
these four statements against `sample_videos`):

```sql
ALTER TABLE "sample_videos" ADD COLUMN "duration" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_videos" ADD COLUMN "quality" text DEFAULT '720p' NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_videos" ADD CONSTRAINT "sample_videos_duration_valid" CHECK ("duration" BETWEEN 1 AND 15);--> statement-breakpoint
ALTER TABLE "sample_videos" ADD CONSTRAINT "sample_videos_quality_valid" CHECK ("quality" IN ('360p', '540p', '720p', '1080p'));
```

- [ ] **Step 3: Apply the migration locally**

Make sure local infra is running, then apply:

```bash
pnpm docker:up
pnpm db:migrate
```

Expected: migration applies with no errors, ending with the new migration's
number in the `Applying migrations` log output.

- [ ] **Step 4: Verify the columns and constraints landed**

```bash
docker exec -i $(docker ps -qf "name=postgres") psql -U tryon -d tryon_dev -c "\d sample_videos"
```

Expected: output lists `duration` (integer, not null, default 8) and
`quality` (text, not null, default '720p'::text), plus two `Check
constraints:` entries (`sample_videos_duration_valid`,
`sample_videos_quality_valid`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/models.ts packages/db/src/migrations/
git commit -m "feat(db): add duration/quality columns to sample_videos"
```

---

### Task 2: Shared PixVerse duration/quality types and pricing formula

**Files:**
- Modify: `packages/types/src/jobs.ts` (add near `PIXVERSE_VIDEO_COST`, line 117)
- Create: `packages/types/src/jobs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all from `packages/types/src/jobs.ts`, re-exported via
  `packages/types/src/index.ts`'s existing `export * from './jobs.js'`):
  - `PIXVERSE_DURATION_MIN = 1`
  - `PIXVERSE_DURATION_MAX = 15`
  - `PIXVERSE_QUALITIES = ['360p', '540p', '720p', '1080p'] as const`
  - `type PixverseQuality = (typeof PIXVERSE_QUALITIES)[number]`
  - `interface PixverseVideoPricingConfig { perSecondRate: number; qualityBase: Record<PixverseQuality, number> }`
  - `function computePixverseVideoCost(duration: number, quality: PixverseQuality, config: PixverseVideoPricingConfig): number`

- [ ] **Step 1: Write the failing test**

Create `packages/types/src/jobs.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computePixverseVideoCost, type PixverseVideoPricingConfig } from './jobs.js';

describe('computePixverseVideoCost', () => {
  const config: PixverseVideoPricingConfig = {
    perSecondRate: 10,
    qualityBase: { '360p': 20, '540p': 40, '720p': 60, '1080p': 100 },
  };

  it('adds quality base to duration * per-second rate', () => {
    expect(computePixverseVideoCost(5, '720p', config)).toBe(60 + 5 * 10);
    expect(computePixverseVideoCost(15, '1080p', config)).toBe(100 + 15 * 10);
  });

  it('rounds fractional totals up', () => {
    const fractional: PixverseVideoPricingConfig = {
      perSecondRate: 0.5,
      qualityBase: { '360p': 1, '540p': 1, '720p': 1, '1080p': 1 },
    };
    // 1 + 3 * 0.5 = 2.5 -> 3
    expect(computePixverseVideoCost(3, '360p', fractional)).toBe(3);
  });

  it('floors the result at 1 credit even if the formula computes to 0 or less', () => {
    const zeroed: PixverseVideoPricingConfig = {
      perSecondRate: 0,
      qualityBase: { '360p': 0, '540p': 0, '720p': 0, '1080p': 0 },
    };
    expect(computePixverseVideoCost(1, '360p', zeroed)).toBe(1);
  });

  it('duration=1 and duration=15 (API boundary values) both compute correctly', () => {
    expect(computePixverseVideoCost(1, '540p', config)).toBe(40 + 1 * 10);
    expect(computePixverseVideoCost(15, '540p', config)).toBe(40 + 15 * 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @aivastra/types test -- jobs.test.ts
```

Expected: FAIL — `computePixverseVideoCost` is not exported from `./jobs.js`.

- [ ] **Step 3: Implement**

In `packages/types/src/jobs.ts`, immediately after the existing
`PIXVERSE_VIDEO_COST` constant (line 117), add:

```typescript
export const PIXVERSE_DURATION_MIN = 1;
export const PIXVERSE_DURATION_MAX = 15;

export const PIXVERSE_QUALITIES = ['360p', '540p', '720p', '1080p'] as const;
export type PixverseQuality = (typeof PIXVERSE_QUALITIES)[number];

export interface PixverseVideoPricingConfig {
  /** Credits charged per second of video, on top of the quality base. */
  perSecondRate: number;
  /** Base credit cost per quality tier, before the per-second addition. */
  qualityBase: Record<PixverseQuality, number>;
}

/**
 * Single source of truth for catalog-video pricing — called by both the API
 * cost resolver (getPixverseVideoCreditCost) and the admin cost-preview UI,
 * so the two can never compute a different number for the same inputs.
 */
export function computePixverseVideoCost(
  duration: number,
  quality: PixverseQuality,
  config: PixverseVideoPricingConfig,
): number {
  const raw = config.qualityBase[quality] + duration * config.perSecondRate;
  return Math.max(1, Math.ceil(raw));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @aivastra/types test -- jobs.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck the package**

```bash
pnpm --filter @aivastra/types typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/jobs.ts packages/types/src/jobs.test.ts
git commit -m "feat(types): add PixVerse duration/quality constants and pricing formula"
```

---

### Task 3: Admin pricing config — `pixverseVideoPricing` replaces flat `pixverse.creditCost`

**Files:**
- Modify: `packages/types/src/admin.ts:101-213` (`SystemConfigBody`)
- Modify: `apps/api/src/lib/resolution-config.ts:32,125-134`
- Modify: `apps/api/src/modules/admin/config.routes.ts:11-19,48-74`
- Modify: `apps/api/src/modules/jobs/create.ts:22-27` (import name only — call site updates in Task 6)
- Modify: `apps/api/src/modules/models/routes.ts:7` (import name only — call site updates in Task 5)

**Interfaces:**
- Consumes: `PixverseQuality`, `PixverseVideoPricingConfig`,
  `computePixverseVideoCost`, `PIXVERSE_QUALITIES`, `PIXVERSE_VIDEO_COST`
  from Task 2.
- Produces:
  - `SystemConfigBody.pixverseVideoPricing` Zod field (replaces `.pixverse`).
  - `DEFAULT_PIXVERSE_VIDEO_PRICING: PixverseVideoPricingConfig` (`apps/api/src/lib/resolution-config.ts`).
  - `getPixverseVideoCreditCost(app: FastifyInstance, duration: number, quality: PixverseQuality): Promise<number>` (replaces `getPixverseCreditCost`).
  - `GET /admin/config` response carries `pixverseVideoPricing` instead of `pixverse`.
  - `PATCH /admin/config` accepts `pixverseVideoPricing` instead of `pixverse`.

- [ ] **Step 1: Replace the `pixverse` field in `SystemConfigBody`**

Replace line 146 (`pixverse: z.object({ creditCost: z.number().int().positive().max(1_000) }).optional(),`)
with:

```typescript
  pixverseVideoPricing: z
    .object({
      // Credits per second of video, added on top of the quality base below.
      perSecondRate: z.number().min(0).max(100),
      qualityBase: z
        .object({
          '360p': z.number().int().positive().max(1_000),
          '540p': z.number().int().positive().max(1_000),
          '720p': z.number().int().positive().max(1_000),
          '1080p': z.number().int().positive().max(1_000),
        })
        .partial(),
    })
    .optional(),
```

(The literal `'360p'`/`'540p'`/`'720p'`/`'1080p'` keys here match
`PIXVERSE_QUALITIES` from `./jobs.js` — Task 4 below adds the actual import
of that constant to this file for its own enum validation, so no unused
import is introduced in this step.)

- [ ] **Step 2: Replace `DEFAULT_PIXVERSE_CONFIG`/`getPixverseCreditCost` in `resolution-config.ts`**

In `apps/api/src/lib/resolution-config.ts`, change the import at the top
(line 1-7) to also pull in the Task 2 exports:

```typescript
import {
  PIXVERSE_VIDEO_COST,
  RESOLUTION_COSTS,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
  type Resolution,
  SAREE_MANNEQUIN_DEV_COST,
  SIMPLE_TRYON_COST,
  computePixverseVideoCost,
} from '@aivastra/types';
```

Replace line 32 (`export const DEFAULT_PIXVERSE_CONFIG: { creditCost: number } = { creditCost: PIXVERSE_VIDEO_COST };`)
with:

```typescript
export const DEFAULT_PIXVERSE_VIDEO_PRICING: PixverseVideoPricingConfig = {
  perSecondRate: 0,
  qualityBase: {
    '360p': PIXVERSE_VIDEO_COST,
    '540p': PIXVERSE_VIDEO_COST,
    '720p': PIXVERSE_VIDEO_COST,
    '1080p': PIXVERSE_VIDEO_COST,
  },
};
```

With `perSecondRate: 0` and every tier defaulted to the current flat cost
(150), an existing 8s/720p template still prices at exactly 150 — nothing
changes until an admin tunes the formula.

Replace the `getPixverseCreditCost` function (lines 125-134) with:

```typescript
export async function getPixverseVideoCreditCost(
  app: FastifyInstance,
  duration: number,
  quality: PixverseQuality,
): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const pricing: PixverseVideoPricingConfig = cfg.pixverseVideoPricing ?? DEFAULT_PIXVERSE_VIDEO_PRICING;
    return computePixverseVideoCost(duration, quality, pricing);
  } catch {
    return computePixverseVideoCost(duration, quality, DEFAULT_PIXVERSE_VIDEO_PRICING);
  }
}
```

- [ ] **Step 3: Update `config.routes.ts`**

In `apps/api/src/modules/admin/config.routes.ts`, change the import block
(lines 11-19) — replace `DEFAULT_PIXVERSE_CONFIG` with
`DEFAULT_PIXVERSE_VIDEO_PRICING`:

```typescript
import {
  DEFAULT_MAX_OUTPUT_PX,
  DEFAULT_PIXVERSE_VIDEO_PRICING,
  DEFAULT_RESOLUTION_CONFIG,
  DEFAULT_SAREE_MANNEQUIN_DEV_CONFIG,
  DEFAULT_SELLER_CONFIG,
  DEFAULT_SHOPIFY_TRIAL_CONFIG,
  DEFAULT_TRYON_CONFIG,
} from '../../lib/resolution-config.js';
```

Replace line 57 (`cfg.pixverse = cfg.pixverse ?? DEFAULT_PIXVERSE_CONFIG;`)
with:

```typescript
    cfg.pixverseVideoPricing = cfg.pixverseVideoPricing ?? DEFAULT_PIXVERSE_VIDEO_PRICING;
```

- [ ] **Step 4: Fix the two now-broken import sites (rename only, logic unchanged for now)**

In `apps/api/src/modules/jobs/create.ts`, line 24: rename
`getPixverseCreditCost` to `getPixverseVideoCreditCost` in the import list
(lines 22-27). Do **not** touch the call site yet — that's Task 6, which also
needs `sample.duration`/`sample.quality` (added in Task 4) to call it
correctly. For now this import will be unused; that's fine, it gets used in
Task 6.

In `apps/api/src/modules/models/routes.ts`, line 7: rename the same import.
Again, the call site (line 82) is fixed in Task 5.

- [ ] **Step 5: Typecheck (expect two pre-existing call-site errors, confirmed here then fixed in Tasks 5-6)**

```bash
pnpm --filter @aivastra/types typecheck
pnpm --filter @aivastra/api typecheck
```

Expected: `@aivastra/types` passes clean. `@aivastra/api` reports exactly two
errors: `getPixverseVideoCreditCost` called with 1 argument but expects 3, in
`jobs/create.ts` and `models/routes.ts`. This is expected and resolved by
Tasks 5 and 6 — do not "fix" it here by reverting the signature.

- [ ] **Step 6: Update the existing admin-config integration test's expectations**

Find the test that asserts on `GET /admin/config`'s `pixverse` field:

```bash
grep -rl "\.pixverse\b" apps/api/test/integration/
```

Open the matching file and change any assertion like
`expect(body.pixverse).toEqual({ creditCost: 150 })` to:

```typescript
    expect(body.pixverseVideoPricing).toEqual({
      perSecondRate: 0,
      qualityBase: { '360p': 150, '540p': 150, '720p': 150, '1080p': 150 },
    });
```

And any `PATCH /admin/config` payload using `{ pixverse: { creditCost: N } }`
to `{ pixverseVideoPricing: { perSecondRate: N, qualityBase: { '720p': N } } }`
(adjust field names to match that test's actual assertions — read the
surrounding test first).

- [ ] **Step 7: Run the affected test file**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts <the file found in step 6>
```

Expected: PASS. (Requires `pnpm docker:up` running.)

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/admin.ts apps/api/src/lib/resolution-config.ts apps/api/src/modules/admin/config.routes.ts apps/api/src/modules/jobs/create.ts apps/api/src/modules/models/routes.ts apps/api/test/integration/
git commit -m "feat(api): replace flat pixverse credit cost with duration/quality pricing formula config"
```

---

### Task 4: Admin sample-video CRUD accepts `duration`/`quality`

**Files:**
- Modify: `packages/types/src/admin.ts:326-338` (`ConfirmSampleVideoBody`, `PatchSampleVideoBody`)
- Modify: `apps/api/src/modules/admin/models.routes.ts:502-534` (create route)
- Modify: `apps/api/test/integration/admin-sample-videos.test.ts`

**Interfaces:**
- Consumes: `PIXVERSE_DURATION_MIN`, `PIXVERSE_DURATION_MAX`,
  `PIXVERSE_QUALITIES` from Task 2; `schema.sampleVideos.duration/quality`
  columns from Task 1.
- Produces: `POST /admin/assets/sample-videos` requires `duration`/`quality`
  in the body and persists them; `PATCH /admin/assets/sample-videos/:id`
  accepts optional `duration`/`quality`; `GET /admin/assets/sample-videos`
  rows include `duration`/`quality` (already automatic — `select()` returns
  all columns, no route code change needed there).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/admin-sample-videos.test.ts`, inside the
`describe` block, after the existing `it('presign -> confirm -> list -> patch -> delete', ...)`:

```typescript
  it('accepts duration/quality on create, defaults to 8/720p if omitted, and allows patching both', async () => {
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

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/sample-videos/${created.id}`,
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ duration: 5, quality: '360p' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const [afterPatch] = await app.db
      .select()
      .from(schema.sampleVideos)
      .where(eq(schema.sampleVideos.id, created.id));
    expect(afterPatch.duration).toBe(5);
    expect(afterPatch.quality).toBe('360p');
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
```

Note: the existing first test in this file (`'presign -> confirm -> list -> patch -> delete'`)
does **not** send `duration`/`quality` in its confirm payload — once
`ConfirmSampleVideoBody` requires them (Step 3 below), that test's confirm
call will start failing with a 400. Fix it in Step 5.

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts admin-sample-videos
```

Expected: FAIL — `created.duration` is `undefined` (field doesn't exist in
the response yet), and the two rejection tests get `200` back instead of
`400` (the fields aren't validated yet).

- [ ] **Step 3: Add `duration`/`quality` to the Zod bodies**

In `packages/types/src/admin.ts`, add this import at the top, alongside the
existing `import { z } from 'zod';`:

```typescript
import { PIXVERSE_DURATION_MAX, PIXVERSE_DURATION_MIN, PIXVERSE_QUALITIES } from './jobs.js';
```

Replace `ConfirmSampleVideoBody` (currently lines 326-332):

```typescript
export const ConfirmSampleVideoBody = z.object({
  title: z.string().min(1).max(120),
  videoR2Key: z.string().min(1),
  thumbnailR2Key: z.string().min(1),
  prompt: z.string().min(1).max(5000),
  sortOrder: z.number().int().default(0),
  duration: z.number().int().min(PIXVERSE_DURATION_MIN).max(PIXVERSE_DURATION_MAX),
  quality: z.enum(PIXVERSE_QUALITIES),
});
```

Replace `PatchSampleVideoBody` (currently lines 333-338):

```typescript
export const PatchSampleVideoBody = z.object({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(5000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  duration: z.number().int().min(PIXVERSE_DURATION_MIN).max(PIXVERSE_DURATION_MAX).optional(),
  quality: z.enum(PIXVERSE_QUALITIES).optional(),
});
```

- [ ] **Step 4: Pass the fields through in the create route**

In `apps/api/src/modules/admin/models.routes.ts`, the `POST
/admin/assets/sample-videos` handler (lines 502-534) destructures `body` with
an inline type and inserts a fixed set of columns. Update the inline type
(lines 506-512) and the insert `.values()` (lines 514-521):

```typescript
      const body = req.body as {
        title: string;
        videoR2Key: string;
        thumbnailR2Key: string;
        prompt: string;
        sortOrder: number;
        duration: number;
        quality: string;
      };
      const [row] = await app.db
        .insert(schema.sampleVideos)
        .values({
          title: body.title,
          videoR2Key: body.videoR2Key,
          thumbnailR2Key: body.thumbnailR2Key,
          prompt: body.prompt,
          sortOrder: body.sortOrder,
          duration: body.duration,
          quality: body.quality,
        })
        .returning();
```

The `PATCH /admin/assets/sample-videos/:id` handler (lines 536-550) already
spreads `body as object` straight into `.set()`, so `duration`/`quality`
flow through automatically once the Zod schema (Step 3) allows them — no
code change needed there.

- [ ] **Step 5: Fix the pre-existing test that didn't send duration/quality**

In the first test in `admin-sample-videos.test.ts` (`'presign -> confirm ->
list -> patch -> delete'`), the confirm payload (around line 45-51) needs
`duration`/`quality` added:

```typescript
      payload: JSON.stringify({
        title: 'Slow turn',
        videoR2Key: presign.videoR2Key,
        thumbnailR2Key: presign.thumbnailR2Key,
        prompt: 'model turns slowly to show the garment from all angles',
        sortOrder: 1,
        duration: 8,
        quality: '720p',
      }),
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts admin-sample-videos
```

Expected: PASS, all tests in the file.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @aivastra/types typecheck
pnpm --filter @aivastra/api typecheck
```

Expected: no errors (the two errors flagged at the end of Task 3 are still
present until Tasks 5-6 — unrelated to this task's files).

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/admin.ts apps/api/src/modules/admin/models.routes.ts apps/api/test/integration/admin-sample-videos.test.ts
git commit -m "feat(admin-api): accept duration/quality on sample-video create and patch"
```

---

### Task 5: `GET /v1/models/sample-videos` returns per-item `creditCost`

**Files:**
- Modify: `apps/api/src/modules/models/routes.ts:64-101`
- Modify: `apps/api/test/integration/sample-videos-public.test.ts`

**Interfaces:**
- Consumes: `getPixverseVideoCreditCost(app, duration, quality)` from Task 3;
  `schema.sampleVideos.duration/quality` from Task 1.
- Produces: `GET /v1/models/sample-videos` response shape changes from
  `{ creditCost: number; items: [...] }` to
  `{ items: Array<{ id, title, thumbnailUrl, previewVideoUrl, creditCost: number }> }`
  — **breaking change**, consumed by Task 11 (web UI).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/integration/sample-videos-public.test.ts`, replace the
single `it('returns only active, non-deleted sample videos ordered by
sortOrder', ...)` test's body (it inserts two active + one inactive sample,
then asserts `body.creditCost`) — change the two active inserts to use
different duration/quality, and change the assertion from a single
top-level `creditCost` to per-item:

```typescript
  it('returns only active, non-deleted sample videos ordered by sortOrder, each with its own creditCost', async () => {
    const [active1] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'B',
        videoR2Key: 'sample-videos/a.mp4',
        thumbnailR2Key: 'sample-videos/a.thumb.jpg',
        prompt: 'p',
        sortOrder: 2,
        duration: 8,
        quality: '720p',
      })
      .returning();
    const [active2] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'A',
        videoR2Key: 'sample-videos/b.mp4',
        thumbnailR2Key: 'sample-videos/b.thumb.jpg',
        prompt: 'p',
        sortOrder: 1,
        duration: 15,
        quality: '1080p',
      })
      .returning();
    await app.db.insert(schema.sampleVideos).values({
      title: 'Inactive',
      videoR2Key: 'sample-videos/c.mp4',
      thumbnailR2Key: 'sample-videos/c.thumb.jpg',
      prompt: 'p',
      isActive: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/sample-videos',
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('creditCost');
    const items = body.items as Array<{
      id: string;
      thumbnailUrl: string;
      previewVideoUrl: string;
      creditCost: number;
    }>;
    expect(items.map((i) => i.id)).toEqual([active2.id, active1.id]);
    // Default pricing config: qualityBase=150 for every tier, perSecondRate=0,
    // so cost is 150 regardless of duration until an admin tunes the formula.
    expect(items[0].creditCost).toBe(150);
    expect(items[1].creditCost).toBe(150);
    expect(items[0].thumbnailUrl).toContain('sample-videos/b.thumb.jpg');
    expect(items[0].previewVideoUrl).toContain('sample-videos/b.mp4');
    expect(items[0].thumbnailUrl).toContain('X-Amz-Signature');
    expect(items[0].previewVideoUrl).toContain('X-Amz-Signature');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts sample-videos-public
```

Expected: FAIL — response still has a top-level `creditCost` and items lack
a per-item `creditCost`.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/models/routes.ts`, the `GET /v1/models/sample-videos`
handler (lines 64-101). Change the `.select()` (lines 72-81) to also pull
`duration`/`quality`, remove the single `getPixverseCreditCost(app)` call
(line 82), and compute cost per row inside the `Promise.all` map (lines
85-98):

```typescript
    const rows = await app.db
      .select({
        id: schema.sampleVideos.id,
        title: schema.sampleVideos.title,
        thumbnailR2Key: schema.sampleVideos.thumbnailR2Key,
        videoR2Key: schema.sampleVideos.videoR2Key,
        duration: schema.sampleVideos.duration,
        quality: schema.sampleVideos.quality,
      })
      .from(schema.sampleVideos)
      .where(and(eq(schema.sampleVideos.isActive, true), isNull(schema.sampleVideos.deletedAt)))
      .orderBy(asc(schema.sampleVideos.sortOrder));
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

Update the import (line 7) — it already reads
`getPixverseVideoCreditCost` from Task 3's rename; add the `PixverseQuality`
type import from `@aivastra/types` at the top of the file:

```typescript
import type { PixverseQuality } from '@aivastra/types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts sample-videos-public
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/api typecheck
```

Expected: one of the two errors flagged at the end of Task 3 is now gone
(the `models/routes.ts` call site) — one remains, in `jobs/create.ts`,
resolved by Task 6.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/models/routes.ts apps/api/test/integration/sample-videos-public.test.ts
git commit -m "feat(api): return per-item creditCost from GET /v1/models/sample-videos"
```

---

### Task 6: `createCatalogVideoJob` prices by the chosen template's duration/quality

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts:1159-1238`
- Modify: `apps/api/test/integration/catalog-video-create.test.ts`

**Interfaces:**
- Consumes: `getPixverseVideoCreditCost(app, duration, quality)` from Task 3;
  `schema.sampleVideos.duration/quality` from Task 1.
- Produces: `job_inputs.params` for a catalog-video job now includes
  `duration: number` and `quality: string`, consumed by Task 7 (dispatcher).
  `jobs.creditsCharged` reflects the formula cost for the specific sample
  video used, not a flat number.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/catalog-video-create.test.ts`, after the
existing `activeSample()` helper (lines 58-69), a variant that sets a custom
duration/quality, and a new test using it:

```typescript
  async function activeSampleWithPricing(duration: number, quality: string) {
    const [row] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'Custom',
        videoR2Key: 'sample-videos/custom.mp4',
        thumbnailR2Key: 'sample-videos/custom.thumb.jpg',
        prompt: 'model turns slowly',
        duration,
        quality,
      })
      .returning();
    return row.id;
  }
```

```typescript
  it('charges the formula-computed cost for the sample video own duration/quality, and snapshots both onto job_inputs.params', async () => {
    const { token, userId } = await registerUser('cv-formula@x.com');
    await grantCredits(userId, 500);
    const sourceJobId = await sourceJob(userId);
    const sampleVideoId = await activeSampleWithPricing(15, '1080p');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    // Default pricing config: qualityBase=150 for every tier, perSecondRate=0
    // -> cost is 150 regardless of duration/quality until an admin tunes it.
    // This asserts the *lookup* is per-sample now, not that the number differs
    // from the flat default (see the JobCostsTab-driven test in Task 10 for
    // an admin-tuned, differing cost).
    expect(job.creditsCharged).toBe(150);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.duration).toBe(15);
    expect(params.quality).toBe('1080p');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts catalog-video-create
```

Expected: FAIL — `params.duration` / `params.quality` are `undefined`
(nothing writes them yet).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/jobs/create.ts`, `createCatalogVideoJob` (lines
1159-1238). Move the `getPixverseVideoCreditCost` call (currently line 1164,
computed before the sample video is even loaded) to *after* the sample
video lookup (currently lines 1200-1205), and pass its
`duration`/`quality` through. Replace lines 1159-1236 with:

```typescript
export async function createCatalogVideoJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateCatalogVideoJobRequest>,
) {
  // Exactly one of sourceJobId or sourceImageKey is present — enforced by
  // CreateCatalogVideoJobRequest's XOR refine. sourceImageKey lets the caller
  // animate any image they own, not required to be an AI Vastra generation;
  // sourceJobId reuses a completed AI Vastra job's own result.
  let resolvedSourceImageKey: string;
  if (body.sourceImageKey) {
    await assertOwnsUploadKey(app, userId, body.sourceImageKey);
    resolvedSourceImageKey = body.sourceImageKey;
  } else if (body.sourceJobId) {
    const sourceJobId = body.sourceJobId;
    const [source] = await app.db
      .select({
        userId: schema.jobs.userId,
        status: schema.jobs.status,
        // Tryon-direct results (source='tryon'/'api_tryon') are WebP-encoded, not
        // PNG (see apps/dispatcher/src/workflow/finalize.ts) — the actual uploaded
        // key must come from here, not be reconstructed via keys.output(sourceJobId).
        resultKey: schema.jobOutputs.resultKey,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(eq(schema.jobs.id, sourceJobId));
    if (!source) throw new AppError('NOT_FOUND', 404, 'source image not found');
    if (source.userId !== userId)
      throw new AppError('FORBIDDEN', 403, 'source image not owned by caller');
    if (source.status !== 'COMPLETED')
      throw new AppError('VALIDATION', 400, 'source image is not a completed job');
    resolvedSourceImageKey = source.resultKey ?? keys.output(sourceJobId);
  } else {
    // Unreachable: CreateCatalogVideoJobRequest's XOR refine guarantees exactly
    // one of sourceJobId/sourceImageKey is present.
    throw new AppError('VALIDATION', 400, 'sourceJobId or sourceImageKey is required');
  }

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

(The rest of the function — the `try { xadd ... } catch { refund ... }`
block, lines 1239-1259 in the original — is unchanged; leave it as-is.)

Add `PixverseQuality` to the `@aivastra/types` import block (lines 5-15):

```typescript
import {
  ASPECT_DIMENSIONS,
  type CreateCatalogVideoJobRequest,
  type CreateSimpleTryonRequest,
  type CreateTryOnJobRequest,
  JOB_SOURCE,
  type JobSource,
  type PixverseQuality,
  type Resolution,
  resolutionFromDims,
  type SareeStep2Inputs,
} from '@aivastra/types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts catalog-video-create
```

Expected: PASS, all tests in the file (including the pre-existing ones —
they use the plain `activeSample()` helper, which now writes the default
`duration=8, quality='720p'`, so `creditsCharged: 150` still holds).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/api typecheck
```

Expected: no errors — the last of the two errors flagged at the end of
Task 3 is now resolved.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/catalog-video-create.test.ts
git commit -m "feat(api): price catalog-video jobs by the sample video's own duration/quality"
```

---

### Task 7: Dispatcher forwards duration/quality to PixVerse

**Files:**
- Modify: `apps/dispatcher/src/pixverse/client.ts:65-102`
- Modify: `apps/dispatcher/src/job/processor.ts:818-863`
- Modify: `apps/dispatcher/test/integration/catalog-video.test.ts`

**Interfaces:**
- Consumes: `job_inputs.params.duration` / `.quality` written by Task 6 (with
  a fallback default for pre-existing/directly-seeded rows that lack them).
- Produces: `createVideoTask(configuredBaseUrl, apiKey, imageUrl, prompt, duration, quality, log?)`
  — signature gains two required parameters between `prompt` and `log`.

- [ ] **Step 1: Write the failing test**

In `apps/dispatcher/test/integration/catalog-video.test.ts`, modify
`seedVideoJob()` (lines 33-67) to include `duration`/`quality` in the seeded
params, and add a new test asserting the PixVerse request body carries them:

```typescript
  async function seedVideoJob(duration = 12, quality = '1080p') {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `video-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    // The API has already deducted the 20 credits recorded on the queued video job.
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 0 });

    const [sourceJob] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status: 'COMPLETED', creditsCharged: 5 })
      .returning();
    await env.db.insert(schema.jobInputs).values({ jobId: sourceJob?.id });
    await env.db.insert(schema.jobOutputs).values({
      jobId: sourceJob?.id,
      resultKey: `outputs/${sourceJob?.id}/result.png`,
    });

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status: 'QUEUED', creditsCharged: 20 })
      .returning();
    await env.db.insert(schema.jobInputs).values({
      jobId: job?.id,
      params: {
        kind: 'video',
        sourceJobId: sourceJob?.id,
        sourceImageKey: `outputs/${sourceJob?.id}/result.png`,
        sampleVideoId: randomUUID(),
        prompt: 'model turning slowly',
        duration,
        quality,
      },
    });

    return { jobId: job?.id as string, userId: user?.id as string };
  }
```

```typescript
  it('sends the job\'s own duration/quality to PixVerse instead of a hardcoded 8/720p', async () => {
    const { jobId, userId } = await seedVideoJob(12, '1080p');
    const log = createLogger('test');

    let capturedBody: Record<string, unknown> | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/image/upload')) {
        return new Response(JSON.stringify({ ErrCode: 0, Resp: { img_id: 123 } }), { status: 200 });
      }
      if (url.includes('/video/img/generate')) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ErrCode: 0, Resp: { video_id: 456 } }), {
          status: 200,
        });
      }
      if (url.includes('/video/result/')) {
        return new Response(
          JSON.stringify({
            ErrCode: 0,
            Resp: { status: 1, url: 'https://pixverse.example/video.mp4' },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://pixverse.example/video.mp4') {
        return new Response(Buffer.from('fake-mp4-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      '1-0',
    );

    expect(capturedBody).toMatchObject({ duration: 12, quality: '1080p' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm docker:up
cd apps/dispatcher && npx vitest run test/integration/catalog-video.test.ts
```

Expected: FAIL — `capturedBody` is `{ duration: 8, quality: '720p', ... }`
(still hardcoded).

- [ ] **Step 3: Update `createVideoTask`**

In `apps/dispatcher/src/pixverse/client.ts`, change the function signature
(lines 65-71) and the request body (lines 79-87):

```typescript
export async function createVideoTask(
  configuredBaseUrl: string,
  apiKey: string,
  imageUrl: string,
  prompt: string,
  duration: number,
  quality: string,
  log?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
): Promise<PixverseTaskResult> {
  const urlBase = baseUrl(configuredBaseUrl);
  const imageId = await uploadImage(urlBase, apiKey, imageUrl);
  const url = `${urlBase}/openapi/v2/video/img/generate`;
  log?.info({ url }, 'POST -> PixVerse create video task');
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders(apiKey),
    body: JSON.stringify({
      duration,
      img_id: imageId,
      model: 'v6',
      motion_mode: 'normal',
      prompt,
      quality,
      seed: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });
```

(rest of the function unchanged).

- [ ] **Step 4: Update `processVideoJob` to pass duration/quality through**

In `apps/dispatcher/src/job/processor.ts`, `processVideoJob` (lines
818-863). Add duration/quality extraction near `prompt` (line 831) and pass
them into `createVideoTask` (currently lines 857-863):

```typescript
  const sourceImageKey = rawParams.sourceImageKey as string;
  const prompt = rawParams.prompt as string;
  // Fallback to today's previous hardcoded values for job_inputs rows written
  // before this field existed (or seeded directly in tests) — every job
  // created via createCatalogVideoJob (Task 6) always sets both.
  const duration = typeof rawParams.duration === 'number' ? rawParams.duration : 8;
  const quality = typeof rawParams.quality === 'string' ? rawParams.quality : '720p';
```

```typescript
    const { taskId } = await createVideoTask(
      env.PIXVERSE_API_BASE_URL,
      env.PIXVERSE_API_KEY,
      imageUrl,
      prompt,
      duration,
      quality,
      jobLog,
    );
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/dispatcher && npx vitest run test/integration/catalog-video.test.ts
```

Expected: PASS, all tests in the file (the pre-existing two tests still pass
since `seedVideoJob()` now defaults to `duration=12, quality='1080p'` args —
they only assert on job status/refund, not on the PixVerse payload, so the
value change doesn't affect them).

- [ ] **Step 6: Confirm `video-lane.test.ts` is unaffected**

```bash
cd apps/dispatcher && npx vitest run test/integration/video-lane.test.ts
```

Expected: PASS — that file's `seedVideoJob` doesn't set `duration`/`quality`
in `params`, exercising the Step 4 fallback path; it only asserts on queue
routing, not PixVerse payload contents, so it's unaffected by the fallback.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @aivastra/dispatcher typecheck
```

If this script doesn't exist for the dispatcher package, use the root
command instead:

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/dispatcher/src/pixverse/client.ts apps/dispatcher/src/job/processor.ts apps/dispatcher/test/integration/catalog-video.test.ts
git commit -m "feat(dispatcher): forward job-specific duration/quality to PixVerse"
```

---

### Task 8: Admin — `SampleVideoUploadModal` collects duration/quality with a live cost preview

**Files:**
- Modify: `apps/admin-web/src/components/SampleVideoUploadModal.tsx`

**Interfaces:**
- Consumes: `PIXVERSE_QUALITIES`, `PIXVERSE_DURATION_MIN`,
  `PIXVERSE_DURATION_MAX`, `computePixverseVideoCost`,
  `PixverseVideoPricingConfig` from `@aivastra/types` (Task 2); `GET
  /admin/config`'s `pixverseVideoPricing` field (Task 3); `POST
  /admin/assets/sample-videos` requiring `duration`/`quality` (Task 4).
- Produces: `SampleVideo` interface gains `duration: number; quality:
  string`, consumed by Task 9 (`SampleVideosTab`).

- [ ] **Step 1: Update the `SampleVideo` interface and imports**

In `apps/admin-web/src/components/SampleVideoUploadModal.tsx`, add to the
top imports:

```typescript
import {
  computePixverseVideoCost,
  PIXVERSE_DURATION_MAX,
  PIXVERSE_DURATION_MIN,
  PIXVERSE_QUALITIES,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
} from '@aivastra/types';
```

Update the `SampleVideo` interface (lines 13-23):

```typescript
export interface SampleVideo {
  id: string;
  title: string;
  videoR2Key: string;
  thumbnailR2Key: string;
  prompt: string;
  duration: number;
  quality: string;
  isActive: boolean;
  sortOrder: number;
  videoUrl: string;
  thumbnailUrl: string;
}
```

- [ ] **Step 2: Add duration/quality state, defaulting to today's values**

In the `SampleVideoUploadModal` component body, alongside the existing
`title`/`prompt`/`sortOrder` state (lines 54-56):

```typescript
  const [duration, setDuration] = useState(8);
  const [quality, setQuality] = useState<PixverseQuality>('720p');
  const [pricing, setPricing] = useState<PixverseVideoPricingConfig | null>(null);
```

Add an effect to fetch the current admin pricing config once, for the live
preview (place it near the existing `useEffect` blocks, after the gif
generation effect):

```typescript
  useEffect(() => {
    apiFetch<{ pixverseVideoPricing?: PixverseVideoPricingConfig }>('/admin/config')
      .then((cfg) => {
        if (cfg.pixverseVideoPricing) setPricing(cfg.pixverseVideoPricing);
      })
      .catch(() => {
        /* preview is best-effort; the submit itself doesn't need this */
      });
  }, []);
```

- [ ] **Step 3: Render the duration/quality inputs with a cost preview, in the step-2 form**

In the `step === 2` block, after the "Sort order" field (lines 241-250), add:

```typescript
          <div className="field">
            <label>Duration (seconds)</label>
            <input
              className="input"
              type="number"
              min={PIXVERSE_DURATION_MIN}
              max={PIXVERSE_DURATION_MAX}
              value={duration}
              onChange={(e) =>
                setDuration(
                  Math.min(
                    PIXVERSE_DURATION_MAX,
                    Math.max(PIXVERSE_DURATION_MIN, Number(e.target.value)),
                  ),
                )
              }
              style={{ width: 100 }}
            />
          </div>
          <div className="field">
            <label>Quality</label>
            <select
              className="input"
              value={quality}
              onChange={(e) => setQuality(e.target.value as PixverseQuality)}
            >
              {PIXVERSE_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
          {pricing && (
            <p className="hint">
              Estimated cost: {computePixverseVideoCost(duration, quality, pricing)} credits
            </p>
          )}
```

- [ ] **Step 4: Send duration/quality on submit**

In the `submit` function's confirm-request payload (lines 110-119), add the
two fields:

```typescript
      const created = await apiFetch<SampleVideo>('/admin/assets/sample-videos', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          videoR2Key: presign.videoR2Key,
          thumbnailR2Key: presign.thumbnailR2Key,
          prompt: prompt.trim(),
          sortOrder,
          duration,
          quality,
        }),
      });
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/admin build
```

(admin-web has no standalone `typecheck` script — `build` runs `tsc` as part
of the Vite build, per its `package.json`; check with `cat
apps/admin-web/package.json` if this differs at execution time and use
whatever script actually type-checks.)

Expected: no type errors.

- [ ] **Step 6: Manual verification**

Per this repo's CLAUDE.md guidance for UI changes, start the admin dev
server and exercise the flow:

```bash
pnpm --filter @aivastra/admin dev
```

Navigate to Assets → Sample Videos → Add sample video, go through both
steps, confirm the duration/quality inputs appear on step 2, the cost
preview updates as you change duration or quality, and the created row (via
`GET /admin/assets/sample-videos` in Network tab, or the card in Task 9)
shows the values you entered.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/SampleVideoUploadModal.tsx
git commit -m "feat(admin-web): collect duration/quality with live cost preview on sample-video upload"
```

---

### Task 9: Admin — `SampleVideosTab` shows each template's duration/quality

**Files:**
- Modify: `apps/admin-web/src/pages/assets/SampleVideosTab.tsx`

**Interfaces:**
- Consumes: `SampleVideo.duration` / `.quality` from Task 8's updated
  interface.
- Produces: nothing consumed downstream (leaf UI change).

- [ ] **Step 1: Add the badge**

In `apps/admin-web/src/pages/assets/SampleVideosTab.tsx`, in the card render
(inside the `.map((item) => ...)`, lines 97-160), add a duration/quality
line right after the existing prompt `<p>` (lines 128-140):

```typescript
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      margin: '2px 0 0',
                    }}
                  >
                    {item.duration}s · {item.quality}
                  </p>
```

- [ ] **Step 2: Manual verification**

With the admin dev server running (from Task 8, Step 6), confirm each card
in Assets → Sample Videos shows its duration/quality under the prompt line.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/pages/assets/SampleVideosTab.tsx
git commit -m "feat(admin-web): show duration/quality on each sample-video card"
```

---

### Task 10: Admin — `JobCostsTab` gets the formula pricing UI

**Files:**
- Modify: `apps/admin-web/src/pages/settings/JobCostsTab.tsx`
- Modify: `apps/api/test/integration/catalog-video-create.test.ts` (one new test — admin-tuned cost actually applies)

**Interfaces:**
- Consumes: `SystemConfigBody.pixverseVideoPricing` shape from Task 3;
  `PIXVERSE_QUALITIES` from Task 2.
- Produces: nothing consumed downstream — this is the admin control surface
  Tasks 3/5/6/8 all read from at runtime.

- [ ] **Step 1: Replace the flat "Catalog Video" section**

In `apps/admin-web/src/pages/settings/JobCostsTab.tsx`:

Replace the `pixverseCreditCost` state (line 20) with:

```typescript
  const [pixverseVideoPricing, setPixverseVideoPricing] = useState<{
    perSecondRate: number;
    qualityBase: Record<'360p' | '540p' | '720p' | '1080p', number>;
  }>({
    perSecondRate: 0,
    qualityBase: { '360p': 150, '540p': 150, '720p': 150, '1080p': 150 },
  });
```

Update the `useEffect` fetch (lines 24-45) — replace the `pixverse?:
{ creditCost: number }` type field and its handling with:

```typescript
    apiFetch<{
      resolutions?: Record<string, { enabled: boolean; creditCost: number }>;
      tryon?: { creditCost: number };
      sareeMannequinDev?: { creditCost: number };
      pixverseVideoPricing?: {
        perSecondRate: number;
        qualityBase: Record<'360p' | '540p' | '720p' | '1080p', number>;
      };
    }>('/admin/config')
      .then((cfg) => {
        if (cfg.resolutions) setResolutions(cfg.resolutions);
        if (cfg.tryon) setTryonCreditCost(cfg.tryon.creditCost);
        if (cfg.sareeMannequinDev) setSareeMannequinDevCreditCost(cfg.sareeMannequinDev.creditCost);
        if (cfg.pixverseVideoPricing) setPixverseVideoPricing(cfg.pixverseVideoPricing);
      })
```

Update the `save` function's PATCH body (lines 50-58) — replace `pixverse:
{ creditCost: pixverseCreditCost }` with:

```typescript
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({
          resolutions,
          tryon: { creditCost: tryonCreditCost },
          sareeMannequinDev: { creditCost: sareeMannequinDevCreditCost },
          pixverseVideoPricing,
        }),
      });
```

Replace the "Catalog Video (PixVerse)" section (lines 228-263) with a
per-second-rate input plus 4 quality-tier base-cost inputs:

```typescript
            <div style={{ marginTop: 24, marginBottom: 8 }}>
              <div className="setting-lbl" style={{ marginBottom: 4 }}>
                Catalog Video Pricing (PixVerse)
              </div>
              <div className="setting-desc" style={{ marginBottom: 12 }}>
                Credit cost per catalog-video generation = quality base + duration (seconds) ×
                per-second rate. Applies per sample-video template's own duration/quality.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                    background: 'var(--surface-2)',
                  }}
                >
                  <span className="setting-lbl">Per-second rate</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      style={{ width: 80, textAlign: 'right' }}
                      value={pixverseVideoPricing.perSecondRate}
                      disabled={saving}
                      onChange={(e) =>
                        setPixverseVideoPricing((prev) => ({
                          ...prev,
                          perSecondRate: Number(e.target.value),
                        }))
                      }
                    />
                    <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      credits / second
                    </span>
                  </div>
                </div>
                {(['360p', '540p', '720p', '1080p'] as const).map((tier) => (
                  <div
                    key={tier}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span className="setting-lbl" style={{ width: 60 }}>
                      {tier}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1000}
                        style={{ width: 80, textAlign: 'right' }}
                        value={pixverseVideoPricing.qualityBase[tier]}
                        disabled={saving}
                        onChange={(e) =>
                          setPixverseVideoPricing((prev) => ({
                            ...prev,
                            qualityBase: { ...prev.qualityBase, [tier]: Number(e.target.value) },
                          }))
                        }
                      />
                      <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        base credits
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aivastra/admin build
```

Expected: no type errors.

- [ ] **Step 3: Manual verification**

With the admin dev server running, go to Settings → Credit Plans → Job
Costs, confirm the new "Catalog Video Pricing" section shows a per-second
rate input and 4 quality-tier inputs (seeded from `GET /admin/config`),
change a value, save, reload the page, and confirm the change persisted.

- [ ] **Step 4: Add an integration test proving an admin-tuned cost actually reaches job creation**

Add to `apps/api/test/integration/catalog-video-create.test.ts`:

```typescript
  it('uses the admin-configured pricing formula, not the hardcoded default, once tuned', async () => {
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
      const { token, userId } = await registerUser('cv-admin-tuned@x.com');
      await grantCredits(userId, 500);
      const sourceJobId = await sourceJob(userId);
      const sampleVideoId = await activeSampleWithPricing(10, '540p');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/catalog-video',
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceJobId, sampleVideoId },
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
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts catalog-video-create
```

Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/pages/settings/JobCostsTab.tsx apps/api/test/integration/catalog-video-create.test.ts
git commit -m "feat(admin-web): replace flat catalog-video cost with duration/quality pricing formula UI"
```

---

### Task 11: Web — `CatalogVideoWizard` shows per-item cost

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx`

**Interfaces:**
- Consumes: `GET /v1/models/sample-videos` new response shape (per-item
  `creditCost`, no top-level `creditCost`) from Task 5.
- Produces: nothing consumed downstream (leaf UI change).

- [ ] **Step 1: Update the `SampleVideoOption` type and query type**

In `apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx`,
update `SampleVideoOption` (lines 18-23):

```typescript
interface SampleVideoOption {
  id: string;
  title: string;
  thumbnailUrl: string;
  previewVideoUrl: string;
  creditCost: number;
}
```

Update the `sampleVideos` query type (lines 373-380) — drop the top-level
`creditCost`:

```typescript
  const { data: sampleVideos, isLoading: sampleVideosLoading } = useQuery<{
    items: SampleVideoOption[];
  }>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
    enabled: step >= 2,
  });
```

- [ ] **Step 2: Derive cost from the selected sample instead of a global value**

Replace line 388 (`const creditCost = sampleVideos?.creditCost;`) — move it
below `selectedSample`'s declaration since it now depends on selection.
Lines 388-401 become:

```typescript
  const balance = creditsData?.balance;
  const imageOptions: CatalogueImageOption[] = (catalogues ?? []).flatMap((catalogue) =>
    catalogue.jobs
      .filter((job) => job.status === 'COMPLETED')
      .map((job) => ({
        jobId: job.id,
        catalogueId: catalogue.catalogueId,
      })),
  );
  const selectedSample = sampleVideos?.items.find((option) => option.id === sampleVideoId);
  const creditCost = selectedSample?.creditCost;
  const insufficientCredits =
    typeof creditCost === 'number' && typeof balance === 'number' && balance < creditCost;
```

(This moves `insufficientCredits`'s computation below `selectedSample`,
and keeps its logic identical — it just now reads a per-selection cost
instead of the removed global one. Every other usage of `creditCost` in the
file — the step-3 summary at lines 862-866, the footer tooltip at line 921 —
is unchanged; they already read the `creditCost` variable, which now simply
resolves per-selection instead of globally.)

- [ ] **Step 3: Show each template's cost in the picker grid**

In the step-2 template grid (lines 736-811), add a cost badge to each card.
Inside the `<button>` for each `option` (lines 740-808), after the title
`<span>` (lines 794-807), add:

```typescript
                          <span
                            style={{
                              display: 'block',
                              padding: '0 12px 10px',
                              fontSize: 11,
                              color: C.mid,
                            }}
                          >
                            {option.creditCost} credits
                          </span>
```

- [ ] **Step 4: Remove the now-redundant pre-selection banner**

The banner at lines 717-730 (`{typeof creditCost === 'number' && (...)}`,
shown above the template grid) previously displayed *before* any template
was picked, using the old global cost. Since `creditCost` now only resolves
once a template is selected, this block naturally stops rendering until
selection — no code change is required here, but re-read lines 712-730
after Steps 1-2 land to confirm the banner now only appears post-selection
(it will, since `creditCost` is `undefined` until `selectedSample` exists).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aivastra/web typecheck
```

Expected: no errors.

- [ ] **Step 6: Manual verification**

Per CLAUDE.md's UI-change guidance:

```bash
pnpm --filter @aivastra/web dev
```

Navigate to the Catalog Video wizard, reach step 2, confirm each template
card shows its own credit cost, confirm no cost banner shows before a
template is picked, confirm it appears after picking one, and confirm the
insufficient-credits states (steps 2 footer tooltip, step 3 summary) react
to the selected template's cost.

- [ ] **Step 7: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/catalog-video/CatalogVideoWizard.tsx"
git commit -m "feat(web): show per-template credit cost in the catalog-video wizard"
```

---

## Final Verification

- [ ] **Full test suites**

```bash
pnpm --filter @aivastra/types test
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/api test:integration
pnpm --filter @aivastra/dispatcher test
```

Expected: all green.

- [ ] **Full typecheck**

```bash
pnpm typecheck
```

Expected: no errors across the monorepo.

- [ ] **Manual end-to-end smoke test**

With `pnpm dev` running: as an admin, create a sample video with a
non-default duration/quality (e.g. 15s/1080p) and a tuned pricing formula
that makes it cost more than 150; as a regular user, open the Catalog Video
wizard, confirm the new template shows the higher cost, generate a video
against it, and confirm (via the admin Jobs page or DB) the job's
`creditsCharged` matches the formula and `job_inputs.params` carries
`duration: 15, quality: '1080p'`.

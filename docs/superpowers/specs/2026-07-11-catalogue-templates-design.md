# Catalogue Templates (Ready-Made Look Sets)

## Goal

Replace the current placeholder "Ready-Made Catalogue Template" feature (which just shortcuts to a single background, derived from background categories) with real admin-defined templates: a named, curated set of (pose, background) pairs — "looks" — scoped to a gender. On the studio page, choosing "Create your own look" keeps today's flow unchanged (pick background, then poses). Choosing a template skips background/pose selection entirely and instead shows the template's looks as checkable cards; the user picks one or more, and (if any picked look needs it) still picks a lower garment / shoe from the catalog, same as today.

No changes to `model_pose_assets`, `model_backgrounds`, `workflow_templates`, or `pose_garment_configs` — templates only *reference* rows in these tables. Workflow assignment (which ComfyUI template a pose uses, per-garment-type overrides) is untouched.

## Database

**Migration** — two new tables:

```sql
CREATE TABLE catalogue_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gender_slug text NOT NULL,
  label text NOT NULL,
  thumbnail_key text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalogue_template_looks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES catalogue_templates(id) ON DELETE CASCADE,
  pose_asset_id uuid NOT NULL REFERENCES model_pose_assets(id),
  background_id uuid NOT NULL REFERENCES model_backgrounds(id),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX catalogue_template_looks_template_id_idx ON catalogue_template_looks(template_id);
```

`gender_slug` matches `model_pose_assets.gender_slug` values (`'men'|'women'|'boys'|'girls'`). Not FK-enforced against pose gender — the admin UI is the enforcement point (only lets you pick poses matching the template's gender), same trust model as `garment_subcategories.tryon_category_id`.

`hasLower`/`hasShoes` for a look are **not** stored here — always computed live from `workflow_templates` + `pose_garment_configs`, overlaid by `garmentTypeId`, exactly like `/v1/models/poses` already does. This is what keeps per-garment-type workflow overrides working unmodified for template looks.

Add corresponding Drizzle schema (`catalogueTemplates`, `catalogueTemplateLooks`) to `packages/db/src/schema/models.ts`.

## API — Admin

New routes in `apps/api/src/modules/admin/models.routes.ts` (mirroring the existing backgrounds/pose-assets admin CRUD shape):

- `GET /admin/assets/catalogue-templates` — list, with look count and thumbnail URL resolved
- `POST /admin/assets/catalogue-templates` — create (label, genderSlug, thumbnailKey, sortOrder)
- `PATCH /admin/assets/catalogue-templates/:id` — update label/thumbnail/active/sortOrder
- `DELETE /admin/assets/catalogue-templates/:id` — soft delete (`deletedAt`)
- `PUT /admin/assets/catalogue-templates/:id/looks` — full-replace: body is the complete ordered list `[{ poseAssetId, backgroundId }]`; handler deletes all existing `catalogue_template_looks` rows for the template and reinserts. Templates have a handful of looks and are edited occasionally, not continuously — full-replace avoids building incremental add/remove/reorder endpoints for no real benefit.

## API — Public

New route in `apps/api/src/modules/models/routes.ts`:

`GET /v1/models/catalogue-templates?gender=&garmentTypeId=`

Returns active templates for the gender, each with looks expanded:

```typescript
{
  items: Array<{
    id: string;
    label: string;
    thumbnailUrl: string | null;
    looks: Array<{
      id: string;              // catalogue_template_looks.id
      poseId: string;
      poseLabel: string;
      poseThumbnailUrl: string;
      backgroundId: string;
      backgroundLabel: string;
      backgroundThumbnailUrl: string;
      hasLower: boolean;
      hasShoes: boolean;
    }>;
  }>;
}
```

`hasLower`/`hasShoes` computed by joining through `workflow_templates` (default) and `pose_garment_configs` (per-`garmentTypeId` override), reusing the same join logic as the existing `/v1/models/poses` handler.

## Admin-Web UI

New tab in `apps/admin-web/src/pages/assets/`: `CatalogueTemplatesTab.tsx`.

- Add `'catalogue-templates'` to `AssetTab` union and `VALID_TABS` in `AssetsContext.tsx`.
- **List view**: cards grouped/filterable by the existing `GenderFilter`, showing cover thumbnail, label, look count, active toggle, sort order — same shell as `BackgroundsTab`/`PoseAssetsTab`.
- **Editor modal**: gender select (locks pose/background pickers below to that gender), label, cover thumbnail upload, active toggle, sort order, and a looks builder — add-row control opens a two-step picker (pose, then background), appends a row showing pose thumb + bg thumb side by side with remove/reorder controls. Save sends the full ordered looks array to the `PUT .../looks` endpoint.

## Studio Page (`apps/catalogues-web/src/app/(app)/studio/page.tsx`)

Fully replaces `readyMadeCatalogueTemplates`/`catalogueTemplates` (currently derived from background categories) — that placeholder mechanism is removed, not kept as a fallback.

- Template section (already positioned right after "Choose your model", before "Select Background") fetches from the new `/v1/models/catalogue-templates` endpoint instead of deriving from background categories. "Custom" card stays first, same as today.
- New state: `selectedLookIds: string[]` (replaces the current "template just sets `backgroundId`" wiring).
- `catalogueTemplateId === 'custom'` → "Select Background" and "Choose Poses" sections render exactly as today, untouched.
- `catalogueTemplateId !== 'custom'` → those two sections are hidden, replaced by a **"Choose Looks"** section: grid of checkable cards (pose thumbnail, background label as caption/badge), multi-select via `selectedLookIds`. Selecting a template resets `selectedLookIds` to `[]` and clears `lowerCatalogId`/`shoeCatalogId`, mirroring `handleFaceSelect`/`handleBackgroundSelect`.
- If every look is filtered out for the current `garmentTypeId` (all poses hidden via `pose_garment_configs` overrides), show an empty-state message ("No looks available for this garment type yet") instead of an empty grid. Submit stays disabled until at least one look is checked (mirrors `poseIds.length === 0` today).
- `needsLower`/`needsShoes`: one shared derivation — `selectedPoses.some(hasLower/hasShoes)` — where `selectedPoses` comes from either `poseIds` (custom mode) or the checked looks' pose objects (template mode).

**Submission** — reuses the existing multi-call-per-catalogue mechanism (the same one the dormant Amazon white-bg flow already uses: first `POST /v1/jobs/tryon` creates the catalogue, later calls pass `catalogueId` to append). No API/schema change needed — `job_inputs` already stores one `backgroundId` per job row.

1. Group checked `selectedLookIds` by `backgroundId`.
2. First group → `POST /v1/jobs/tryon` with that group's `backgroundId` + `poseIds`, no `catalogueId`.
3. Remaining groups → same shape, `catalogueId` from step 2's response.
4. The one shared `lowerCatalogId`/`shoeCatalogId` pick is passed on every group's call (no-op for groups whose poses don't need it).

## Testing

Integration tests in `apps/api` (fresh-DB-per-test-file harness, per existing convention):

- Admin CRUD for `catalogue_templates` + `PUT .../looks` full-replace behavior
- `GET /v1/models/catalogue-templates` — join correctness, including `garmentTypeId` override interaction (a look's pose hidden via `pose_garment_configs` should not appear, or should appear with corrected `hasLower`/`hasShoes`)

No new frontend test infra — verify the studio page changes via typecheck + lint + manual run, consistent with how the earlier template-section reorder was verified.

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/schema/models.ts` | Add `catalogueTemplates`, `catalogueTemplateLooks` tables |
| `packages/db/src/migrations/` | New migration SQL file |
| `apps/api/src/modules/admin/models.routes.ts` | Admin CRUD + looks full-replace endpoint |
| `apps/api/src/modules/models/routes.ts` | New `GET /v1/models/catalogue-templates` |
| `apps/api/src/modules/admin/__tests__/` | Tests for new admin routes |
| `apps/api/src/modules/models/__tests__/` (or equivalent) | Tests for new public route |
| `packages/types/src/admin.ts` | Zod schemas for template create/update/looks-replace bodies |
| `packages/types/src/index.ts` | Re-export new types |
| `apps/admin-web/src/pages/assets/AssetsContext.tsx` | Add `'catalogue-templates'` tab |
| `apps/admin-web/src/pages/assets/CatalogueTemplatesTab.tsx` | New tab UI |
| `apps/admin-web/src/types.ts` | Add `CatalogueTemplate`/`CatalogueTemplateLook` interfaces |
| `apps/catalogues-web/src/app/(app)/studio/page.tsx` | Replace category-derived templates with real endpoint; add "Choose Looks" section; per-background-group submission |

## Order of Implementation

1. Migration + DB schema
2. Type schemas (Zod)
3. Admin API routes + tests
4. Public API route + tests
5. Admin-web UI (`CatalogueTemplatesTab.tsx`)
6. Studio page (template fetch, "Choose Looks" section, grouped submission)

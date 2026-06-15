# Admin Mobile — Phases 2–8 Implementation Plan

Based on `docs/admin-mobile-implementation.md`. Phase 1 (scaffold + auth + login)
is complete.

---

## Shared Prerequisites (build before any phase)

These components and utilities are used by multiple phases and must exist first.

### Shared components

| File | Purpose |
|------|---------|
| `src/components/StatusBadge.tsx` | Colored pill: QUEUED=blue, PREPROCESSING=amber, GENERATING=amber, UPLOADING=amber, COMPLETED=green, FAILED=red, CANCELLED=gray |
| `src/components/ConfirmDialog.tsx` | `Alert.alert` wrapper for destructive actions |
| `src/components/FilterChips.tsx` | Horizontal `ScrollView` of pill buttons |
| `src/components/EmptyState.tsx` | Centered icon + title + subtitle + optional action button |
| `src/components/SkeletonLoader.tsx` | Animated shimmer placeholders: `card` / `list` / `detail` / `grid` |
| `src/components/PullToRefresh.tsx` | Thin wrapper: `ScrollView` / `FlatList` with `RefreshControl` + automatic `onRefresh` |
| `src/components/Toast.tsx` | Top toast queue (Zustand-powered, animated) |

### Shared hooks

| File | Purpose |
|------|---------|
| `src/hooks/useApi.ts` | Generic `useQuery`-like hook: loads data, returns `{ data, loading, error, refresh }` |
| `src/hooks/usePagination.ts` | FlatList page management: `{ items, loadMore, hasMore, refresh }` |
| `src/hooks/useSSE.ts` | Wraps `createSSEConnection` from `src/lib/sse.ts`, auto-cleanup on unmount. Uses `fetch()` with streaming body `.getReader()`, NOT `EventSource` (EventSource doesn't support Authorization headers in React Native) |

### Shared lib

| File | Purpose |
|------|---------|
| `src/lib/sse.ts` | Custom fetch-based SSE reader (from design doc §3.3) |
| `src/lib/format.ts` | Date formatting (`timeAgo`, `formatDate`), number formatting (`formatNumber`) |
| `src/lib/thumbnail.ts` | `expo-image-manipulator` wrapper (from design doc §3.4) |

### Types Reference (`src/types.ts`)

**Imported from `apps/admin/src/types.ts` (copy verbatim):**
`ModelFace`, `ModelBackground`, `GarmentType`, `WorkflowOption`, `ModelPose`,
`CatalogCategory`, `CatalogItem`, `User`, `Job`, `Worker`, `CreditPlan`, `ModelPoseAsset`

**Mobile-specific types (add to `src/types.ts`):**

```ts
// Admin roles — includes 'ADMIN' which the API guard accepts but @aivastra/types omits
export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN';

// Dashboard stats — omits failed24hDelta (API does not return this)
export interface Stats {
  jobsToday: number;
  jobsTodayDelta: number;
  creditsToday: number;
  creditsTodayDelta: number;
  activeUsersToday: number;
  activeUsersDelta: number;
  workersHealthy: number;
  workersTotal: number;
  workers: DashboardWorker[];
  queueDepth: number;
  failed24h: number;
  recentFailures: { id: string; user: string; error: string; age: string }[];
  stuckJobs: { id: string; user: string; age: string }[];
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
  sevenDayTotal: number;
}

// Dashboard worker — subset of Worker returned by /admin/stats
export interface DashboardWorker {
  id: string;
  status: string;
  healthy: boolean;
  lastSeen?: string;
}

// Full worker — returned by /admin/workers (for future workers screen)
export interface Worker {
  id: string;
  status: string;
  healthy: boolean;
  lastSeen?: string;
  completed: number;
  currentJob?: string;
  uptime: number;
}

// Job detail — extends base Job with extra fields from /admin/jobs/:id
export interface JobDetail extends Job {
  inputImages: {
    face?: string;
    background?: string;
    pose?: string;
    upper?: string;
    lower?: string;
    shoe?: string;
  };
  events: JobEvent[];
  userHint?: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

// Note: workerId, errorCode, resultKey, and thumbnailKey live inside
// payload, not as top-level fields. Access via event.payload?.workerId, etc.

// SSE stream event — shape published by /admin/jobs/stream
export interface AdminJobEvent {
  jobId: string;
  userId: string;
  type: 'STATUS';
  status: JobStatus;
  workerId?: string;
  errorCode?: string;
  resultKey?: string;
  thumbnailKey?: string;
}
```

---

## Phase 2: Dashboard + Jobs

**API:** `/admin/stats`, `/admin/workers`, `/admin/jobs`, `/admin/jobs/:id`,
`/admin/jobs/:id/cancel`, `/admin/jobs/:id/retry`, `/admin/jobs/stream` (SSE)

### 2.1 Files to create

```
src/
├── app/(tabs)/
│   ├── home.tsx                  # Replace placeholder with real Dashboard
│   └── jobs/
│       ├── _layout.tsx           # Stack navigator
│       ├── index.tsx             # Job list with filters + SSE
│       └── [id].tsx              # Job detail (timeline, images, cancel/retry)
├── components/
│   ├── StatCard.tsx              # Icon + label + value + delta arrow
│   ├── WorkerCard.tsx            # Status dot + name + GPU
│   ├── JobCard.tsx               # Status badge + email + credits + time ago
│   └── EventTimeline.tsx         # Vertical timeline for job events
└── hooks/
    └── useAdminJobStream.ts      # SSE connection to /admin/jobs/stream
```

### 2.2 Build order

1. `src/types.ts` — copy interfaces from `apps/admin/src/types.ts` and define mobile-specific types:
   - `Stats` (without `failed24hDelta` — the API does not return this field)
   - `Worker` (full: `id, status, healthy, lastSeen, completed, currentJob, uptime`)
   - `DashboardWorker` (dashboard-only: `id, status, healthy, lastSeen`)
   - `Job` (list endpoint shape)
   - `JobDetail` (extends `Job` — adds `inputImages`, `events: JobEvent[]`, `userHint`)
   - `JobEvent` (timeline entry)
   - `AdminJobEvent` (SSE stream shape: `jobId, userId, type, status, workerId?, errorCode?, resultKey?, thumbnailKey?`)
   - `AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN'`
2. `src/lib/sse.ts` — fetch-based SSE reader (NOT EventSource — use `fetch()` then `response.body.getReader()` for streaming SSE parsing; pass `Authorization` header with token from `useAuthStore`)
3. `src/lib/format.ts` — `timeAgo()`, `formatNumber()`
4. `src/hooks/useApi.ts` — generic data-fetching hook
5. `src/hooks/useSSE.ts` — wraps `createSSEConnection`, auto-cleanup on unmount
6. `src/components/StatCard.tsx`
7. `src/components/WorkerCard.tsx` — uses `DashboardWorker`, not full `Worker`
8. `src/components/StatusBadge.tsx` — needed by JobCard.
   Color map: QUEUED=blue, PREPROCESSING=amber, GENERATING=amber, UPLOADING=amber, COMPLETED=green, FAILED=red, CANCELLED=gray
9. `src/components/FilterChips.tsx` — needed by job list.
   Job chips: [All] [Queued] [Generating] [Completed] [Failed] [Cancelled].
   PREPROCESSING and UPLOADING are transient states — visible only under [All], no dedicated chip.
10. `src/components/JobCard.tsx`
11. `src/app/(tabs)/home.tsx` — replace placeholder. Uses `stats.workers` directly (no separate `/admin/workers` call needed — the dashboard stat already returns `workers: DashboardWorker[]`)
12. `src/app/(tabs)/jobs/_layout.tsx` — stack navigator
13. `src/app/(tabs)/jobs/index.tsx` — job list
14. `src/components/EventTimeline.tsx`
15. `src/hooks/useAdminJobStream.ts` — SSE subscription to `/admin/jobs/stream`, publishes `AdminJobEvent` objects
16. `src/app/(tabs)/jobs/[id].tsx` — job detail

### 2.3 Dashboard screen (`home.tsx`)

**Data flow:**
- On mount + 30s interval: `GET /admin/stats` → render stat cards, worker list (from `stats.workers`), failures, stuck queue.
  No separate `/admin/workers` call — `stats.workers` already returns `{ id, status, healthy, lastSeen }[]`.

**UI states:**
- **Loading:** 6 skeleton stat cards (shimmer)
- **Loaded:** 2-column card grid, worker list, failures section, stuck queue
- **Error:** Retry button with error message
- **Empty workers:** "No workers connected" warning banner
- **All offline:** Red warning banner at top

**Stat cards (6):**
| Card | Endpoint field | Delta | Tap action |
|------|---------------|-------|------------|
| Jobs Today | `jobsToday` | `jobsTodayDelta` | → Jobs tab (All) |
| Credits Consumed | `creditsToday` | `creditsTodayDelta` | (no nav) |
| Active Users | `activeUsersToday` | `activeUsersDelta` | → Users screen |
| Workers Healthy | `workersHealthy` | none (show /total) | → Worker list section |
| Queue Depth | `queueDepth` | none | → Jobs tab (Queued) |
| Failed 24h | `failed24h` | **none** (API has no delta) | → Jobs tab (Failed) |

**Charts:** `jobsPerDay: number[]` + `jobsPerDayLabels: string[]` for the
7-day bar chart. `sevenDayTotal` for the summary count.

**Worker pool:** uses `workers: DashboardWorker[]` from stats (`id, status, healthy, lastSeen`).

**Recent failures:** uses `recentFailures` — each entry has `id`, `user` (email), `error` (code), `age` (pre-formatted string like "2m", "5h").

**Stuck queue:** uses `stuckJobs` — each entry has `id`, `user` (email), `age` (pre-formatted string).

### 2.4 Job list screen (`jobs/index.tsx`)

**Data flow:**
- `GET /admin/jobs?page=1&pageSize=25&status=<filter>` on mount + filter change
- `onEndReached` → load next page
- `onRefresh` → reset to page 1
- SSE stream: `GET /admin/jobs/stream` → update badges in-place (no full re-render)

**Filter chips (6 chips for 7 statuses):**
```
[All] [Queued] [Generating] [Completed] [Failed] [Cancelled]
```
PREPROCESSING and UPLOADING are transient states — visible only under [All], no dedicated chip.

**UI states:**
- **Loading:** 8 skeleton list rows
- **Loaded:** FlatList with `JobCard` rows
- **Empty:** "No jobs found" empty state
- **Error:** Retry button
- **Paginating:** Spinner at list footer
- **SSE disconnect:** Silent fallback to 15s poll interval

**JobCard layout per row:**
```
┌──────────────────────────────────────────────┐
│ [status dot]  Generating     user@email.com  │
│               Job #abc123    12 credits      │
│               2 min ago                       │
└──────────────────────────────────────────────┘
```

### 2.5 Job detail screen (`jobs/[id].tsx`)

**Data flow:**
- `GET /admin/jobs/:id` on mount

**Sections (collapsible accordions):**
1. **Header:** Status badge, job ID, credits, created/updated timestamps
2. **Input Images:** Face, Background, Pose, Upper, Lower, Shoe — thumbnail → tap for fullscreen `ImagePreview`
3. **Output:** Full-size image (if completed) — tap to zoom
4. **Events Timeline:** Vertical timeline with event type, worker, timestamp. Expandable JSON for COMFY_DISPATCH events (copy-to-clipboard button)

**Action buttons (conditionally shown):**
- Cancel — visible if status is QUEUED/PREPROCESSING/GENERATING/UPLOADING
- Retry — visible if status is FAILED

**UI states:**
- **Loading:** Skeleton with placeholder blocks
- **Loaded:** Accordion sections
- **Not found:** "Job not found" empty state
- **Cancel/Retry pending:** Button shows spinner, disabled

---

## Phase 3: Users

**API:** `/admin/users`, `/admin/users/:id`, `/admin/credits/grant`, `PATCH /admin/users/:id`

### 3.1 Files to create

```
src/
├── app/(tabs)/more/
│   └── users/
│       ├── _layout.tsx           # Stack navigator
│       ├── index.tsx             # User list with search + pagination
│       └── [id].tsx              # User detail (profile, recent jobs, grant credits, ban)
├── components/
│   ├── UserRow.tsx               # Avatar + name + email + tier badge + balance
│   └── GrantCreditsModal.tsx     # Amount input + reason + submit
```

### 3.2 Build order

1. `src/types.ts` — add `User` interface
2. `src/components/UserRow.tsx`
3. `src/components/GrantCreditsModal.tsx` — modal with text inputs
4. `src/components/ConfirmDialog.tsx` — needed for ban/unban
5. `src/hooks/usePagination.ts` — needed for user list
6. `src/app/(tabs)/more/users/_layout.tsx`
7. `src/app/(tabs)/more/users/index.tsx`
8. `src/app/(tabs)/more/users/[id].tsx`
9. Wire "Users" menu item in `more.tsx` — navigate to users stack

### 3.3 User list screen (`users/index.tsx`)

**Data flow:**
- `GET /admin/users?page=1&pageSize=50&search=<query>` on mount + search change
- `onEndReached` → load next page
- `onRefresh` → reset to page 1

**UI states:**
- **Loading:** 10 skeleton rows
- **Loaded:** FlatList with `UserRow` items
- **Empty:** "No users found" empty state
- **Error:** Retry button
- **Search active:** Search bar at top of list

### 3.4 User detail screen (`users/[id].tsx`)

**Sections:**
1. **Profile header:** Avatar, display name, email, tier badge, balance, account status
2. **Recent jobs:** Last 20 jobs (flat list, each row: status + date + credits)
3. **Actions:**
   - **Grant Credits** → opens `GrantCreditsModal` (amount 1–10000 + reason string)
   - **Ban/Unban** → `ConfirmDialog` with toggle action

**UI states:**
- **Loading:** Skeleton detail
- **Loaded:** Full profile
- **Not found:** "User not found" empty state
- **Grant credits success:** Toast + refresh
- **Ban/unban success:** Toast + refresh

---

## Phase 4: Assets — Core (Faces + Backgrounds)

**API:** `/admin/assets/faces`, `/admin/assets/backgrounds`, all presign/confirm/patch/delete endpoints

### 4.1 Files to create

```
src/
├── app/(tabs)/assets/
│   ├── _layout.tsx               # Replace placeholder — hub layout
│   ├── index.tsx                 # Asset category grid (was placeholder)
│   ├── faces/
│   │   ├── _layout.tsx           # Stack navigator
│   │   ├── index.tsx             # Face list (gender filter + card grid)
│   │   ├── [id].tsx              # Face detail → edit
│   │   └── upload.tsx            # Face upload (presign → R2 → confirm)
│   └── backgrounds/
│       ├── _layout.tsx           # Stack navigator
│       ├── index.tsx             # Background list (table with thumbnails)
│       ├── [id].tsx              # Background detail → edit
│       └── upload.tsx            # Background upload
├── components/
│   ├── ImagePreview.tsx          # Fullscreen pinch-to-zoom image modal
│   ├── AssetCard.tsx             # Face card (image + label + active toggle)
│   ├── AssetRow.tsx              # Background row (thumbnail + label + sort)
│   └── UploadProgress.tsx        # Per-file progress bar
```

### 4.2 Build order

1. `src/types.ts` — add `ModelFace`, `ModelBackground` interfaces
2. `src/lib/thumbnail.ts` — `expo-image-manipulator` wrapper
3. `src/components/ImagePreview.tsx` — pinch-to-zoom modal
4. `src/components/UploadProgress.tsx` — progress bar
5. `src/components/AssetCard.tsx` — face card
6. `src/components/AssetRow.tsx` — background row
7. `src/components/EmptyState.tsx` — "No faces yet" etc.
8. `src/components/SkeletonLoader.tsx` — grid/list/detail variants
9. `src/components/PullToRefresh.tsx` — wrapper
10. `src/app/(tabs)/assets/index.tsx` — replace placeholder with category grid
11. `src/app/(tabs)/assets/_layout.tsx` — hub layout
12. `src/app/(tabs)/assets/faces/_layout.tsx`
13. `src/app/(tabs)/assets/faces/index.tsx` — face list
14. `src/app/(tabs)/assets/faces/[id].tsx` — face detail/edit
15. `src/app/(tabs)/assets/faces/upload.tsx` — face upload
16. `src/app/(tabs)/assets/backgrounds/_layout.tsx`
17. `src/app/(tabs)/assets/backgrounds/index.tsx`
18. `src/app/(tabs)/assets/backgrounds/[id].tsx`
19. `src/app/(tabs)/assets/backgrounds/upload.tsx`

### 4.3 Asset Hub (`assets/index.tsx`)

**Layout:** 2-column card grid (phone) / 3-column (tablet)
- Model Faces → card with icon + item count
- Backgrounds → card with icon + item count
- Garment Types → card (navigates to Phase 5 screen when built)
- Pose Assets → card (navigates to Phase 5 screen when built)
- Catalog → card (navigates to Phase 6 screen when built)

### 4.4 Face list (`faces/index.tsx`)

**Data flow:**
- `GET /admin/assets/faces` on mount + refresh

**Filter:** Gender chips: [All] [Men] [Women] [Boys] [Girls]

**UI states:**
- **Loading:** 6 skeleton `AssetCard` items in grid
- **Loaded:** Card grid (2 columns) with thumbnail + label + active toggle
- **Empty:** "No faces" empty state → "Add Face" action
- **Long-press:** Bulk select mode → delete selected

**FAB:** "Add Face" → navigates to upload screen

### 4.5 Face detail/edit (`faces/[id].tsx`)

**Sections:**
- Full-size image preview
- Edit fields: label, gender (picker), sort order (number input)
- Active toggle
- Replace image (opens image picker → presign → upload → confirm via `PATCH`)
- Delete (moves to recycle bin)

### 4.6 Face upload (`faces/upload.tsx`)

**Three-step flow:**
1. **Form:** Image picker → fields: label, gender (picker), sort order
2. **Upload:** `POST /admin/assets/faces/presign` → `PUT` to R2 (with progress) → generate thumbnail via `expo-image-manipulator` → `PUT` thumbnail to R2
3. **Confirm:** `POST /admin/assets/faces/confirm` → navigate back + refresh list

### 4.7 Background list/upload

Same pattern as faces but with table layout (thumbnail + label + sort + isWhiteBg + active). Gender filter chips. Upload form adds: gender select, is-white-background toggle.

### 4.8 Upload flow (shared pattern)

Used by **faces, backgrounds, poses, pose assets, and catalog items** — asset types
that presign both a main image and a thumbnail. Garment types are **excluded** (see
note below). Common code extracted to:

```ts
// src/lib/upload.ts
interface UploadConfig {
  presignEndpoint: string;
  confirmEndpoint: string;
  fields: UploadField[];
}

async function uploadAsset(config: UploadConfig, file: ImagePickerAsset, formData: Record<string, unknown>): Promise<void> {
  // Step 1: presign — returns { uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }
  const { uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey } = await apiFetch(config.presignEndpoint, { method: 'POST', body: JSON.stringify({ contentType: 'image/jpeg' }) });

  // Step 2: upload main + thumbnail
  await uploadToR2(uploadUrl, file.uri, (progress) => { /* update state */ });
  const thumb = await makeThumbnail(file.uri);
  await uploadToR2(thumbnailUploadUrl, thumb);

  // Step 3: confirm
  await apiFetch(config.confirmEndpoint, { method: 'POST', body: JSON.stringify({ ...formData, r2Key, thumbnailKey }) });
}
```

> **Garment types use a different flow** (`Phase 5`):
> `POST /admin/assets/garment-types/presign` returns only `{ uploadUrl, thumbnailKey }`
> — there is no main image, no `r2Key`, and no separate `/confirm` endpoint.
> The create step is `POST /admin/assets/garment-types` with the form fields plus
> the `thumbnailKey`. Do **not** use `uploadAsset()` for garment types.

---

## Phase 5: Assets — Advanced (Poses + Pose Assets + Garment Types)

**API:** All `/admin/assets/poses/*`, `/admin/assets/pose-assets/*`, `/admin/assets/garment-types/*`

### 5.1 Files to create

```
src/
├── app/(tabs)/assets/
│   ├── garment-types/
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # Garment type list
│   │   ├── [id].tsx              # GT detail → poses for this GT
│   │   └── upload.tsx            # GT upload
│   ├── poses/
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # Poses for selected GT (face×bg grid)
│   │   ├── [id].tsx              # Pose detail → edit
│   │   └── upload.tsx            # Pose upload (2-step: workflow → image)
│   └── pose-assets/
│       ├── _layout.tsx
│       ├── index.tsx             # Pose asset list (paginated, filterable)
│       ├── [id].tsx              # PA detail → edit
│       ├── upload.tsx            # PA upload
│       └── map.tsx               # Map PA to garment types
├── components/
│   ├── WorkflowPicker.tsx        # Dropdown/picker for workflow selection
│   └── GarmentTypeMapModal.tsx   # Multi-select garment type picker
```

### 5.2 Build order

1. `src/types.ts` — add `GarmentType`, `ModelPose`, `ModelPoseAsset`, `WorkflowOption`
2. `src/components/WorkflowPicker.tsx`
3. `src/components/GarmentTypeMapModal.tsx`
4. GT screens: `_layout` → `index` → `[id]` → `upload`
5. Pose screens: `_layout` → `index` → `[id]` → `upload`
6. Pose Asset screens: `_layout` → `index` → `[id]` → `upload` → `map`
7. Wire category cards in `assets/index.tsx`

### 5.3 Garment Types (`garment-types/index.tsx`)

**Data flow:** `GET /admin/assets/garment-types` → table with pose count per GT

**UI:** FlatList rows: thumbnail + label + slug + gender + pose count + active toggle. Tap → poses for that GT.

### 5.4 Poses (`poses/index.tsx`)

**Data flow:** `GET /admin/assets/poses?garmentTypeId=<id>&faceId=<id>&backgroundId=<id>`

**Layout:** Face (top) × Background (left) grid. Each cell shows a pose thumbnail. Tap → edit. Empty cell → "Add pose for this face+bg combo" button.

### 5.5 Pose upload (`poses/upload.tsx`)

**Two-step wizard:**
1. Select workflow (picker), select face (existing or new), select background (existing or new)
2. Upload pose image + optional faceSide + bgComfy images → presign → R2 → confirm

### 5.6 Pose Assets (`pose-assets/index.tsx`)

**Data flow:** `GET /admin/assets/pose-assets` → paginated list (50/page)

**Filters:** Face picker, background picker, workflow picker, gender chips

**Layout:** FlatList cards: pose thumbnail + label + face/bg/workflow info. Tap → detail. Long-press → bulk select → delete / bulk map.

### 5.7 Pose Asset map (`pose-assets/map.tsx`)

**Data flow:** `POST /admin/assets/pose-assets/bulk-map`

**Layout:** Multi-select garment type picker. Select PAs first (via long-press from list), then tap "Map" → select target GTs → confirm.

---

## Phase 6: Catalog

**API:** All `/admin/catalog/*`

### 6.1 Files to create

```
src/
├── app/(tabs)/assets/catalog/
│   ├── _layout.tsx
│   ├── index.tsx                 # Category tree with item grid
│   ├── item/[id].tsx             # Item detail → edit
│   └── upload.tsx                # Batch upload (multi-file)
├── components/
│   └── CategoryTree.tsx          # Nested accordion or horizontal pills
```

### 6.2 Build order

1. `src/types.ts` — add `CatalogCategory`, `CatalogItem`
2. `src/components/CategoryTree.tsx`
3. Catalog screens: `_layout` → `index` → `item/[id]` → `upload`
4. Wire "Catalog" card in `assets/index.tsx`

### 6.3 Catalog screen (`catalog/index.tsx`)

**Data flow:**
- `GET /admin/catalog/categories` → render category tree
- `GET /admin/catalog/items?categoryId=<id>&genderSlug=<slug>` → render item grid

**Layout:** Category tree (horizontal pills or accordion) at top. Selecting a category loads its items in a grid below. Each item: thumbnail + label + sort order + active toggle.

### 6.4 Batch upload (`catalog/upload.tsx`)

**Data flow:**
- Select multiple images from gallery
- Edit label per row
- Set shared gender + start sort order
- Sequential upload per item: presign → R2 → confirm

**UI states:**
- **File selection:** Multi-select image picker
- **Label editing:** FlatList of selected images with TextInput per row
- **Uploading:** Per-row progress indicator, overall progress counter ("3 of 8 uploaded")

---

## Phase 7: Workflows + Recycle Bin

### 7.1 Files to create

```
src/
├── app/(tabs)/more/workflows/
│   ├── _layout.tsx
│   ├── index.tsx                 # Workflow list
│   ├── [id].tsx                  # Workflow detail (node mappings + raw JSON)
│   └── upload.tsx                # Upload JSON → parse → review → create
├── app/(tabs)/more/recycle-bin/
│   ├── _layout.tsx               # Top tab bar: Faces | Backgrounds | Pose Assets
│   ├── index.tsx                 # Default tab (faces)
│   └── (tabs)/                   # Or use a single screen with internal tabs
└── components/
    └── JsonViewer.tsx            # Collapsible JSON tree with copy button
```

### 7.2 Build order

1. `src/types.ts` — add `WorkflowOption`, recycle bin types
2. `src/components/JsonViewer.tsx`
3. Workflow screens: `_layout` → `index` → `[id]` → `upload`
4. Recycle Bin screens: `_layout` → tabbed screen
5. Wire "Workflows" and "Recycle Bin" menu items in `more.tsx`

### 7.3 Workflow upload (`workflows/upload.tsx`)

**Three-step flow:**
1. Pick JSON file from device
2. `POST /admin/workflows/parse` → shows detected node mappings
3. Review + manual override → `POST /admin/workflows` → create

### 7.4 Workflow detail (`workflows/[id].tsx`)

**Sections:**
- Label, slug, active status
- Node mappings table (faceNodeId, poseNodeId, bgNodeId, etc.)
- Default prompts (facePhasePrompt, garmentPhasePrompt)
- Raw JSON viewer with copy button
- Reassign button (modal: select target workflow, bulk-reassign poses)
- Delete (only if no poses use it)

### 7.5 Recycle bin

**Data flow:** `GET /admin/assets/recycle-bin`

**Layout:** 3 internal tabs (Faces | Backgrounds | Pose Assets). Each tab has a paginated list. Long-press → select mode → Restore / Permanent Delete.

**Permanent delete:** Requires typing confirmation phrase ("DELETE" in a text input) before the button enables.

---

## Phase 8: Settings + Config

### 8.1 Files to create

```
src/
├── app/(tabs)/more/settings/
│   ├── _layout.tsx
│   └── index.tsx                 # Credit plans CRUD + theme + logout
├── app/(tabs)/more/
│   └── config.tsx                # System config form
└── components/
    └── CreditPlanRow.tsx         # Credit plan card
```

### 8.2 Build order

1. `src/types.ts` — add `CreditPlan`
2. `src/components/CreditPlanRow.tsx`
3. Settings screen: credit plans list → inline create/edit via bottom sheet
4. Config screen: text inputs for creditCostPerJob, maxJobsPerDay
5. Wire "Settings" and "Config" in `more.tsx` (SUPER_ADMIN only)

### 8.3 Settings screen (`settings/index.tsx`)

**Sections:**
- **Credit Plans:** List of plans. Each row: slug, name, credits, price (basePaise). Swipe left for delete. Floating "Add Plan" button opens bottom sheet form.
- **Appearance:** Theme toggle (light/dark)
- **Session:** Logout button (reuses `useAuthStore.logout`)

### 8.4 Config screen (`more/config.tsx`)

**Data flow:** `GET /admin/config` → `PATCH /admin/config`

**Layout:** Simple form with 2 text inputs + Save button. Shows current values on mount, updated values on save.

---

## Cross-Cutting Checklist (applied per-phase)

Every screen in every phase must include:

| Concern | Implementation |
|---------|---------------|
| **Loading state** | `<SkeletonLoader variant="..." />` matching the layout |
| **Empty state** | `<EmptyState icon="..." title="..." action={...} />` |
| **Error state** | Error message + "Retry" button calling refresh |
| **Pull-to-refresh** | `RefreshControl` on `ScrollView` / `FlatList` |
| **Error boundary** | Per-screen try/catch or `<ErrorBoundary>` wrapper (use `componentDidCatch` equivalent) |
| **Tablet layout** | `useWindowDimensions` → adjust columns (1/2/3 based on width) |
| **Keyboard handling** | `KeyboardAvoidingView` + `ScrollView` for forms with text inputs |
| **Toast feedback** | On create/update/delete success → toast "Face updated" etc. |

---

## Navigation Wiring (per-phase updates to `more.tsx`)

As each phase completes, the placeholder menu items in `more.tsx` become real
navigation targets:

```
Phase 3: Users    → navigate to /more/users
Phase 7: Workflows → navigate to /more/workflows
Phase 7: Recycle   → navigate to /more/recycle-bin
Phase 5: Workers   → navigate to /more/workers (inline in Phase 2 dashboard, but also a list view)
Phase 8: Settings  → navigate to /more/settings
Phase 8: Config    → navigate to /more/config
```

---

## Summary — File Count by Phase

| Phase | New files | Screens |
|-------|-----------|---------|
| Shared | 11 (components + hooks + lib + types) | 0 |
| 2: Dashboard + Jobs | 8 | 4 |
| 3: Users | 4 | 3 |
| 4: Assets Core | 11 | 8 |
| 5: Assets Advanced | 11 | 12 |
| 6: Catalog | 5 | 6 |
| 7: Workflows + Recycle Bin | 7 | 5 |
| 8: Settings + Config | 4 | 3 |
| **Total** | **61** | **41** |

# Admin Dashboard — Inputs & Requirements

## Context

Aivastra is an AI-powered virtual try-on SaaS. Users upload a garment image, pick 4 catalog items (model, pose, background, lower garment), and receive an AI-generated try-on result.

**Stack:** Next.js 15 · Fastify 5 API · PostgreSQL 16 · Redis 7 · Cloudflare R2

**All `/admin/*` API routes are already built.** The admin frontend consumes them.

**Admin roles:** SUPER_ADMIN (full access), MODERATOR (catalog + jobs), SUPPORT (users + credits). 1-3 admin users total. Desktop only (1024px+).

---

## Pages

| # | Page | Purpose |
|---|------|---------|
| 1 | Dashboard | System health overview |
| 2 | Catalog | CRUD for catalog items + category tree |
| 3 | Users | User list, detail, credit ledger, grant/deduct |
| 4 | Jobs | Job oversight, force retry/cancel, worker status |
| 5 | Settings | System-wide config parameters |

---

## Page 1: Dashboard

### Data displayed

From `GET /admin/stats`:
- Jobs created today
- Credits consumed today
- Active users today (unique users who created a job)
- Healthy worker count (from Redis `worker:health:*` keys)
- Queue depth (pending entries in `jobs:priority` + `jobs:normal`)
- Failed job count (last 24 hours)
- Jobs per day (last 7 days, for a chart)

### Actions
- Click any stat card → navigate to relevant detail page with filter applied (e.g., click failed jobs → Jobs page filtered by FAILED)

### States
- Loading: show loading state while stats fetch
- Empty: first-time setup with zero values
- All workers offline: prominent warning
- API error: per-card retry

---

## Page 2: Catalog

### Data displayed

From `GET /admin/catalog`:
- All catalog items with: thumbnail, label, category name, type name, active flag, sort order
- Filterable by: type (models/poses/backgrounds/lower), category, active/inactive
- Search by label
- Paginated

### Sub-views

**2a. Item list (default)**
- Grid or table of items with thumbnail preview
- Click item → edit modal
- Bulk select → bulk delete, bulk toggle active, bulk move category

**2b. Add / Edit item**
- Fields: label, type, category, sort order
- Upload full-size image (required, JPEG/PNG, max 10MB)
- Upload thumbnail image (required, JPEG/PNG, max 500KB)
- Upload flow: `POST /admin/catalog/items/presign` → upload to R2 presigned URL → `POST /admin/catalog/items/confirm`
- Show upload progress per file
- Validate file type and size before upload

**2c. Category tree manager**
- Display all types and their nested categories
- Add/edit/delete categories (delete blocked if items exist under category)
- Reorder categories via sort_order

### API endpoints

| Method | Endpoint | Use |
|--------|----------|-----|
| `GET` | `/admin/catalog` | List items with filters |
| `POST` | `/admin/catalog/items/presign` | Get signed R2 upload URLs |
| `POST` | `/admin/catalog/items/confirm` | Confirm upload, create DB record |
| `PATCH` | `/admin/catalog/items/:id` | Update item (label, category, active, sort) |
| `DELETE` | `/admin/catalog/items/:id` | Delete item + remove from R2 |
| `POST` | `/admin/catalog/categories` | Create category |
| `PATCH` | `/admin/catalog/categories/:id` | Update category |
| `DELETE` | `/admin/catalog/categories/:id` | Delete category |

### States
- Empty: no items in catalog
- Uploading: progress bars, cancel option
- Upload error: inline error with retry
- Delete item: confirmation dialog
- Delete category with children: warn and block

---

## Page 3: Users

### Data displayed

From `GET /admin/users` (list):
- Columns: display name, email, tier (FREE/PRO), credit balance, account status (active/banned), join date
- Search by name or email
- Filter by tier, filter by status
- Paginated with total count

From `GET /admin/users/:id` (detail):
- User info: email, display name, tier, status, join date
- Credit balance (numeric)
- Total jobs submitted
- Full credit ledger (date, delta, reason, admin who acted)
- Recent jobs (job ID, status, created date)

### Actions

- Ban/unban user
- Change tier (FREE ↔ PRO)
- Grant credits: amount + reason (free text)
- Deduct credits: amount + reason
- Bulk grant: grant same amount to all users of a tier
- Force logout (invalidate refresh tokens)
- Soft-delete user account
- From recent jobs: view job detail, retry failed job

### API endpoints

| Method | Endpoint | Use |
|--------|----------|-----|
| `GET` | `/admin/users` | List users |
| `GET` | `/admin/users/:id` | User detail |
| `PATCH` | `/admin/users/:id` | Update tier, ban/unban |
| `DELETE` | `/admin/users/:id` | Soft-delete account |
| `POST` | `/admin/credits/grant` | Grant credits to one user |
| `POST` | `/admin/credits/bulk-grant` | Grant to all users of a tier |
| `POST` | `/admin/credits/deduct` | Deduct from one user |
| `GET` | `/admin/credits/ledger/:userId` | Credit ledger for user |
| `GET` | `/admin/credits/stats` | System-wide credit stats |

### States
- Loading: skeleton rows for table, skeleton cards for detail
- Empty search: "No users match your search"
- User detail not found: 404 state
- Credit grant/deduct: confirmation dialog before executing
- API error: inline error on affected row/section

---

## Page 4: Jobs

### Data displayed

From `GET /admin/jobs` (list):
- Columns: job ID, user email, status, worker ID, age (time since creation)
- Filter by: status, priority, date range
- Search by job ID or user email
- Paginated

From `GET /admin/jobs/:id` (detail):
- Job ID, user email, created timestamp
- Status with current state
- Worker ID used and total duration
- Credits charged
- Status timeline (QUEUED → PREPROCESSING → GENERATING → UPLOADING → COMPLETED, with timestamps)
- Input images: garment (user upload), model, pose, background, lower garment (thumbnail previews via presigned URLs)
- Output image: result preview (if COMPLETED)
- Error message (if FAILED)

**Worker status sub-view** (from `GET /admin/workers`):
- Per worker: ID, status (IDLE/BUSY/DRAINING), last seen time, health (from Redis), jobs completed

### Actions

- Force retry a FAILED job
- Cancel a stuck job + refund credits
- Drain a worker (mark DRAINING → finish current job, take no new ones)

### Job statuses

`QUEUED` → `PREPROCESSING` → `GENERATING` → `UPLOADING` → `COMPLETED`
Any status can go to `FAILED` or `CANCELLED`.

### API endpoints

| Method | Endpoint | Use |
|--------|----------|-----|
| `GET` | `/admin/jobs` | List all jobs |
| `GET` | `/admin/jobs/:id` | Job detail |
| `POST` | `/admin/jobs/:id/retry` | Force retry |
| `POST` | `/admin/jobs/:id/cancel` | Cancel + refund |
| `GET` | `/admin/workers` | Worker registry status |
| `POST` | `/admin/workers/:id/drain` | Mark worker as draining |

### States
- Empty: no jobs match filter
- Loading: skeleton rows
- Stuck job (QUEUED > 10 min): flag/indicator
- Worker offline: health failure indicator
- Worker draining: DRAINING badge
- Cancel/retry: confirmation dialog

---

## Page 5: Settings

### Data displayed / editable

From `GET /admin/config`:

**Credit settings:**
- Cost per try-on job (credits)
- Max jobs per user per day
- Max concurrent jobs per user
- Default credits for new users

**Job settings:**
- Max retry attempts
- Job timeout (minutes)
- XPENDING claim threshold (ms)

### Actions

- Edit any parameter → `PATCH /admin/config`
- Save button (disabled until changes exist)

### API endpoints

| Method | Endpoint | Use |
|--------|----------|-----|
| `GET` | `/admin/config` | Current configuration |
| `PATCH` | `/admin/config` | Update configuration |

### States
- Loading: form fields disabled
- Unsaved changes: indicator
- Save success: confirmation
- Save error: inline error

---

## Functional Requirements

### Navigation
- Persistent top-level navigation between all 5 pages
- Current page highlighted
- Breadcrumbs on detail pages (e.g., Users → user@email.com)
- Back navigation from detail to list

### Data tables (used on Users, Jobs, Catalog)
- Sortable by column headers
- Pagination with configurable page size
- Row count summary
- Clickable rows navigate to detail
- Loading state (skeleton or spinner, no layout shift)
- Empty state per table

### Image handling
- Catalog thumbnails: displayed via presigned R2 URLs
- Job input/output images: thumbnails via presigned R2 URLs
- Catalog upload: 3-step flow (presign → direct upload → confirm)
- Upload progress bars with cancel support

### Confirmation dialogs
- Required before: delete (item/category/user), ban user, grant/deduct credits, retry/cancel job
- Show what is being acted on and the consequence
- Credit operations: show amount and reason

### Notifications
- Success actions: auto-dismiss
- Error: persist until dismissed, show error details
- Unsaved changes: warn before navigating away

### Error handling
- API errors: displayed inline near the affected component
- Network errors: retry option
- 403/unauthorized: redirect to login
- 404 not found: friendly not-found state

### Access control
- SUPER_ADMIN: all pages and actions
- MODERATOR: Catalog + Jobs pages only
- SUPPORT: Users page only
- UI hides navigation items and action buttons based on role
- API returns 403 — UI shows permission denied

### Browser support
- Desktop only (1024px minimum width)
- Modern browsers (Chrome, Firefox, Edge latest 2 versions)

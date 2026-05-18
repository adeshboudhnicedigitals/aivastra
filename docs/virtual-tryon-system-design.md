# Virtual Try-On Platform — System Design v2

**Project:** AI-Powered Virtual Try-On SaaS  
**Stack:** Next.js · Node.js/TypeScript · Fastify · PostgreSQL · Redis · Cloudflare R2 · Cloudflare Tunnels · ComfyUI on Hostinger VPS  
**Target Scale:** 100 subscribers at launch (v1), 2× VPS GPU workers  

---

## Change Log: v1 → v2

| Area | v1 | v2 |
|---|---|---|
| GPU Workers | RunPod pods (ephemeral, cloud) | Hostinger VPS (persistent, self-managed) |
| Worker connectivity | RunPod public proxy + Bearer token | Cloudflare Tunnel (zero-trust, no open ports) |
| Dispatcher routing | Direct HTTPS to RunPod endpoints | Single Cloudflare LB hostname → tunnel per VPS |
| User inputs | 5 user-uploaded images | 1 user upload (garment) + 4 catalog selections from R2 |
| Catalog system | Not present | Category/subcategory taxonomy, R2-backed, admin-managed |
| Admin panel | Single credit grant endpoint | Full CRUD: R2 catalog, user accounts, credit system, job oversight |

---

## 1. Architecture Overview

### 1.1 High-Level Diagram

```
Internet Traffic
      │
      ▼
┌─────────────────────────────────────┐
│         Cloudflare (Free/Pro)       │
│  DDoS · WAF · Rate Limit · SSL/CDN  │
│  Tunnel Ingress Controller          │
└──────────────┬──────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Hostinger VPS — Main (CloudPanel)         │
│                                                              │
│  ┌─────────────────┐    ┌────────────────────────────────┐   │
│  │   Next.js 15    │    │      Fastify API (TS)          │   │
│  │   (port 3000)   │◀───│      (port 4000)               │   │
│  │                 │SSE │                                │   │
│  │  Garment upload │    │  /auth         JWT + refresh   │   │
│  │  Catalog picker │    │  /jobs         CRUD + SSE      │   │
│  │  Job dashboard  │    │  /uploads      R2 presign      │   │
│  │  Result viewer  │    │  /credits      balance+ledger  │   │
│  │  Admin panel    │    │  /catalog      browse+select   │   │
│  └─────────────────┘    │  /admin/*      full CRUD       │   │
│                         └───────────────┬────────────────┘   │
│                                         │                    │
│  ┌──────────────────┐  ┌────────────────▼───────────────┐    │
│  │   PostgreSQL     │  │            Redis               │    │
│  │   (127.0.0.1)    │  │         (127.0.0.1)            │    │
│  │                  │  │                                │    │
│  │  users           │  │  Stream: jobs:priority         │    │
│  │  user_credits    │  │  Stream: jobs:normal           │    │
│  │  credit_ledger   │  │  Hash:   worker:registry       │    │
│  │  jobs            │  │  Key:    sse:events:{userId}   │    │
│  │  job_inputs      │  │  Key:    worker:health:{id}    │    │
│  │  job_events      │  └────────────────────────────────┘    │
│  │  job_outputs     │                                        │
│  │  catalog_items   │  ┌────────────────────────────────┐    │
│  │  catalog_cats    │  │   Dispatcher Service (TS)      │    │
│  │  admin_users     │  │                                │    │
│  └──────────────────┘  │  Redis Stream consumer         │    │
│                        │  Worker health monitor         │    │
│                        │  Workflow template patcher     │    │
│                        │  Retry logic (max 2)           │    │
│                        │  Credit refund on failure      │    │
│                        │  SSE event publisher           │    │
│                        └───────────────┬────────────────┘    │
└────────────────────────────────────────┼────────────────────┘
                                         │
                          Cloudflare Tunnel (named: tryon-workers)
                          Single logical hostname: workers.internal
                                         │
                   ┌─────────────────────┴──────────────────────┐
                   │          Cloudflare Load Balancer           │
                   │   Health-check aware · weighted routing     │
                   └──────────┬──────────────────┬──────────────┘
                              │                  │
              ┌───────────────▼──┐          ┌────▼─────────────────┐
              │  Hostinger VPS A │          │  Hostinger VPS B     │
              │  1× A100 80GB    │          │  1× A100 80GB        │
              │                  │          │                      │
              │  cloudflared     │          │  cloudflared         │
              │  ComfyUI :8188   │          │  ComfyUI :8188       │
              │  tunnel-id: A    │          │  tunnel-id: B        │
              └──────────────────┘          └──────────────────────┘

                        ┌──────────────────────────────┐
                        │        Cloudflare R2          │
                        │                              │
                        │  virtual-tryon-prod/          │
                        │    inputs/{jobId}/            │
                        │      garment.jpg  ← user     │
                        │    outputs/{jobId}/           │
                        │      result.png               │
                        │    catalog/                   │
                        │      models/{id}.jpg          │
                        │      poses/{id}.jpg           │
                        │      backgrounds/{id}.jpg     │
                        │      lower/{id}.jpg           │
                        └──────────────────────────────┘
```

---

## 2. Cloudflare Tunnel Architecture

This replaces the RunPod public proxy approach. No ports are exposed on Hostinger VPS machines.

### 2.1 How It Works

```
Dispatcher (on main VPS)
    │  POST https://workers.tryon.internal/prompt
    │
    ▼
Cloudflare Network (Argo Tunnel)
    │  Matches tunnel route
    │  Performs health check
    │
    ▼
cloudflared daemon (on ComfyUI VPS A or B)
    │  Forwards to localhost:8188
    │
    ▼
ComfyUI /prompt endpoint
```

### 2.2 Tunnel Setup Per Worker VPS

Each ComfyUI VPS runs a `cloudflared` daemon:

```bash
# On each ComfyUI VPS — run once to create tunnel
cloudflared tunnel create tryon-worker-a      # produces tunnel-id-a
cloudflared tunnel create tryon-worker-b      # produces tunnel-id-b

# Route each tunnel to a hostname
cloudflared tunnel route dns tryon-worker-a  worker-a.tryon.yourdomain.com
cloudflared tunnel route dns tryon-worker-b  worker-b.tryon.yourdomain.com
```

**Config file on VPS A** (`~/.cloudflared/config.yml`):
```yaml
tunnel: tryon-worker-a
credentials-file: /root/.cloudflared/<tunnel-id-a>.json
ingress:
  - hostname: worker-a.tryon.yourdomain.com
    service: http://localhost:8188
  - service: http_status:404
```

### 2.3 Load Balancer (Cloudflare — requires Pro or $5 LB add-on)

```
Hostname: workers.tryon.yourdomain.com
  └── Pool: comfyui-workers
        ├── Origin: worker-a.tryon.yourdomain.com  weight=1
        └── Origin: worker-b.tryon.yourdomain.com  weight=1

Health Check:
  Path: /system_stats
  Expected: HTTP 200
  Interval: 15s
  Unhealthy threshold: 2 failures
  Healthy threshold: 1 success
```

> **If you want to avoid the LB cost ($5/mo):** The dispatcher can maintain its own worker registry in Redis with per-worker URLs (`worker-a.tryon.yourdomain.com`, `worker-b...`) and do health-check-aware routing itself. This is the fallback described in Section 4.3.

### 2.4 Security

```
Cloudflare Access Policy (Zero Trust — free tier):
  Application: workers.tryon.yourdomain.com/*
  Policy: Service Token only
    → Dispatcher sends CF-Access-Client-Id + CF-Access-Client-Secret headers
    → Direct browser access blocked
    → ComfyUI UI never publicly reachable
```

---

## 3. Input Model — Catalog + User Upload

### 3.1 What the User Provides

| Input | Source | How |
|---|---|---|
| Upper Garment | User upload | Direct-to-R2 presigned URL |
| Model / Face | R2 Catalog | Dropdown → radio select |
| Pose | R2 Catalog | Radio select with thumbnail preview |
| Background | R2 Catalog | Radio select with thumbnail preview |
| Lower Garment | R2 Catalog | Dropdown → radio select by subcategory |

### 3.2 Catalog Taxonomy

```
catalog/
├── models/
│   ├── men/          → e.g. model-m-001.jpg, model-m-002.jpg
│   ├── women/        → model-w-001.jpg ...
│   ├── boys/         → model-b-001.jpg ...
│   └── girls/        → model-g-001.jpg ...
│
├── poses/
│   ├── front-standing/
│   ├── side-view/
│   └── casual/
│
├── backgrounds/
│   ├── studio-white/
│   ├── outdoor/
│   └── lifestyle/
│
└── lower/
    ├── men/
    │   ├── trousers/
    │   ├── jeans/
    │   └── shorts/
    ├── women/
    │   ├── sarees/
    │   ├── lehengas/
    │   └── trousers/
    ├── boys/
    └── girls/
```

### 3.3 Catalog DB Schema

```sql
-- Top-level grouping (models, poses, backgrounds, lower_garments)
CREATE TABLE catalog_types (
  id         SERIAL PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,  -- 'models', 'poses', 'backgrounds', 'lower'
  label      TEXT NOT NULL
);

-- Hierarchical categories (men > kurta, women > saree, etc.)
CREATE TABLE catalog_categories (
  id         SERIAL PRIMARY KEY,
  type_id    INTEGER REFERENCES catalog_types(id),
  parent_id  INTEGER REFERENCES catalog_categories(id),  -- null = top level
  slug       TEXT NOT NULL,
  label      TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Actual catalog items
CREATE TABLE catalog_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   INTEGER REFERENCES catalog_categories(id),
  label         TEXT NOT NULL,
  r2_key        TEXT NOT NULL,          -- full R2 key path
  thumbnail_key TEXT NOT NULL,          -- smaller preview version
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 Revised Job Request Shape

```typescript
interface CreateTryOnJobRequest {
  inputs: {
    upperGarmentKey: string      // R2 key, user-uploaded
    modelCatalogId:  string      // UUID from catalog_items
    poseCatalogId:   string      // UUID from catalog_items
    backgroundCatalogId: string  // UUID from catalog_items
    lowerCatalogId:  string      // UUID from catalog_items
  }
  params?: {
    seedStage1?:   number
    seedStage2?:   number
    stepsStage1?:  number   // default: 12
    stepsStage2?:  number   // default: 16
    outputWidth?:  number   // default: 2048
    outputHeight?: number   // default: 2048
  }
  userHint?: string         // max 300 chars, sanitized
}
```

API validates all 4 catalog IDs exist and are `is_active = true` before deducting credits.

---

## 4. Dispatcher — Worker Routing

### 4.1 Worker Registry (Redis)

Each ComfyUI VPS is registered with its tunnel URL:

```
Redis Hash: worker:registry
  worker-a → { url: "https://worker-a.tryon.yourdomain.com", status: "IDLE", lastSeen: <ts> }
  worker-b → { url: "https://worker-b.tryon.yourdomain.com", status: "IDLE", lastSeen: <ts> }

Redis Key: worker:health:worker-a  → "OK"  (TTL: 30s, refreshed by health probe)
Redis Key: worker:health:worker-b  → "OK"  (TTL: 30s, refreshed by health probe)
```

### 4.2 Health Monitor

Dispatcher runs a background probe every 15s per worker:

```typescript
async function probeWorker(workerId: string, url: string) {
  try {
    const res = await fetch(`${url}/system_stats`, {
      headers: {
        'CF-Access-Client-Id': CF_CLIENT_ID,
        'CF-Access-Client-Secret': CF_CLIENT_SECRET
      },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      await redis.set(`worker:health:${workerId}`, 'OK', 'EX', 30);
    } else {
      await redis.del(`worker:health:${workerId}`);
    }
  } catch {
    await redis.del(`worker:health:${workerId}`);
  }
}
```

### 4.3 Worker Selection (No Cloudflare LB Required)

```typescript
async function selectWorker(): Promise<Worker | null> {
  const workers = await redis.hgetall('worker:registry');

  for (const [id, raw] of Object.entries(workers)) {
    const w = JSON.parse(raw);
    if (w.status !== 'IDLE') continue;

    const healthy = await redis.get(`worker:health:${id}`);
    if (!healthy) continue;

    // Atomically claim worker
    const claimed = await redis.hset('worker:registry', id,
      JSON.stringify({ ...w, status: 'BUSY' })
    );
    if (claimed) return { id, ...w };
  }
  return null;  // all workers busy or unhealthy → job stays in stream
}
```

This means even without the Cloudflare LB, the dispatcher handles routing safely. If VPS A goes down, its health key expires, and all jobs route to VPS B automatically.

### 4.4 Revised Request Lifecycle

```
1. User selects garment category → subcategory filter updates
   User uploads upper garment image → direct to R2 (presigned URL)
   User selects: model, pose, background, lower garment from catalog UI
        │
        ▼
2. Frontend POST /v1/jobs/tryon
   { upperGarmentKey, modelCatalogId, poseCatalogId, backgroundCatalogId, lowerCatalogId }
        │
        ▼
3. API validates all catalog IDs (active, exist)
   Atomic credit deduct → 402 if insufficient
   Resolves catalog IDs → R2 keys for all 4 catalog inputs
   Writes job to Postgres (status=QUEUED)
   Pushes to Redis Stream
   Returns { jobId }
        │
        ▼
4. Frontend opens SSE → GET /v1/jobs/{jobId}/events
        │
        ▼
5. Dispatcher: XREADGROUP from stream
   Calls selectWorker() → picks healthy IDLE worker
   Fetches all 5 R2 keys (1 user + 4 catalog)
   Patches ComfyUI workflow template with all 5 image sources
   POST https://worker-a.tryon.yourdomain.com/prompt
        │
        ▼
6. Dispatcher listens on ComfyUI WebSocket for progress
   Publishes SSE events: PREPROCESSING → GENERATING → UPLOADING
        │
        ▼
7. ComfyUI completes → Dispatcher:
   Fetches output from ComfyUI /history
   Uploads result.png to R2 outputs/{jobId}/result.png
   Updates Postgres → COMPLETED
   Marks worker IDLE
   XACK message
   Pushes SSE complete event with signed R2 URL
```

---

## 5. Admin Panel

### 5.1 Access Control

```sql
CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN', 'MODERATOR', 'SUPPORT');

CREATE TABLE admin_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),   -- links to main users table
  role       admin_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Admin JWT contains `{ sub: userId, role: 'ADMIN', adminRole: 'SUPER_ADMIN' }`.  
All `/admin/*` routes verify `adminRole` via middleware before any handler runs.

### 5.2 Admin API Surface

#### User & Account Management
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/users` | Paginated user list with filters (active, banned, tier) |
| `GET` | `/admin/users/:id` | Full user profile + credit balance + job history |
| `PATCH` | `/admin/users/:id` | Update tier, ban/unban, force-logout (invalidate refresh tokens) |
| `DELETE` | `/admin/users/:id` | Soft-delete user account |

#### Credit System
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/admin/credits/grant` | Grant credits to one user with reason note |
| `POST` | `/admin/credits/bulk-grant` | Grant credits to all users of a tier |
| `POST` | `/admin/credits/deduct` | Manual deduct (abuse case) |
| `GET` | `/admin/credits/ledger/:userId` | Full credit ledger for a user |
| `GET` | `/admin/credits/stats` | Total credits issued/consumed system-wide |

#### Catalog (R2 Object Management)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/catalog` | List all catalog items with filters |
| `POST` | `/admin/catalog/items` | Upload new catalog item (presign → confirm) |
| `PATCH` | `/admin/catalog/items/:id` | Update label, category, sort order, active flag |
| `DELETE` | `/admin/catalog/items/:id` | Delete item + remove from R2 |
| `POST` | `/admin/catalog/categories` | Add new category/subcategory |
| `PATCH` | `/admin/catalog/categories/:id` | Rename, reorder, enable/disable category |
| `DELETE` | `/admin/catalog/categories/:id` | Only if no active items under it |
| `POST` | `/admin/catalog/bulk-upload` | Upload multiple catalog items as a ZIP |

#### Job Oversight
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/jobs` | All jobs across all users, paginated + filterable |
| `GET` | `/admin/jobs/:id` | Full job detail including worker used, timing |
| `POST` | `/admin/jobs/:id/retry` | Force retry a FAILED job |
| `POST` | `/admin/jobs/:id/cancel` | Force cancel a stuck job + refund credits |
| `GET` | `/admin/workers` | Live worker registry status from Redis |
| `POST` | `/admin/workers/:id/drain` | Mark worker as draining (no new jobs, finish current) |

#### System Config
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/config` | Current system settings (credit costs, rate limits) |
| `PATCH` | `/admin/config` | Update settings (credit cost per job, max jobs/day) |
| `GET` | `/admin/stats` | Dashboard summary: jobs today, credits consumed, active users |

### 5.3 R2 Catalog Upload Flow (Admin)

```
Admin selects image file(s) in admin panel
    │
    ▼
POST /admin/catalog/items/presign  → returns { uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey }
    │
    ▼
Admin panel uploads full image + thumbnail directly to R2
    │
    ▼
POST /admin/catalog/items/confirm  { r2Key, thumbnailKey, label, categoryId, sortOrder }
    → API writes to catalog_items table
    → Item immediately available in catalog picker (if is_active=true)
```

Thumbnail generation: either admin uploads both, or API auto-generates thumbnail via a Sharp resize job server-side after confirm.

---

## 6. Database Schema (Full v2)

```sql
-- Users
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  display_name     TEXT,
  tier             TEXT DEFAULT 'FREE',   -- FREE, PRO
  is_banned        BOOLEAN DEFAULT FALSE,
  ban_reason       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Credits
CREATE TABLE user_credits (
  user_id   UUID PRIMARY KEY REFERENCES users(id),
  balance   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE credit_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  delta       INTEGER NOT NULL,          -- positive=grant, negative=deduct
  reason      TEXT NOT NULL,             -- 'JOB_DISPATCH', 'ADMIN_GRANT', 'REFUND', etc.
  job_id      UUID,                      -- null for manual grants
  admin_id    UUID,                      -- null for system actions
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs
CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'QUEUED',
  worker_id       TEXT,
  priority        BOOLEAN DEFAULT FALSE,
  credits_charged INTEGER NOT NULL DEFAULT 1,
  attempts        INTEGER DEFAULT 0,
  error_code      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE TABLE job_inputs (
  job_id              UUID PRIMARY KEY REFERENCES jobs(id),
  upper_garment_key   TEXT NOT NULL,     -- user-uploaded R2 key
  model_catalog_id    UUID REFERENCES catalog_items(id),
  pose_catalog_id     UUID REFERENCES catalog_items(id),
  background_catalog_id UUID REFERENCES catalog_items(id),
  lower_catalog_id    UUID REFERENCES catalog_items(id),
  user_hint           TEXT,
  params              JSONB
);

CREATE TABLE job_outputs (
  job_id     UUID PRIMARY KEY REFERENCES jobs(id),
  result_key TEXT,                       -- R2 key for result image
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE job_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID REFERENCES jobs(id),
  event_type TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Catalog
CREATE TABLE catalog_types (
  id    SERIAL PRIMARY KEY,
  slug  TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE catalog_categories (
  id         SERIAL PRIMARY KEY,
  type_id    INTEGER REFERENCES catalog_types(id),
  parent_id  INTEGER REFERENCES catalog_categories(id),
  slug       TEXT NOT NULL,
  label      TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT TRUE
);

CREATE TABLE catalog_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   INTEGER REFERENCES catalog_categories(id),
  label         TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  thumbnail_key TEXT NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Admin
CREATE TABLE admin_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'SUPPORT',   -- SUPER_ADMIN, MODERATOR, SUPPORT
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens (for force-logout support)
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Frontend — User Flow

```
Landing / Login
    │
    ▼
Try-On Builder (main user screen)
    │
    ├── Step 1: Category Selection
    │       Dropdown: Men / Women / Boys / Girls
    │       Sub-dropdown: Tops / Kurta / Shirt / T-shirt ... (filtered by category)
    │
    ├── Step 2: Upload Garment
    │       Drag-drop or file picker
    │       Instant R2 presign upload
    │       Preview thumbnail shown
    │
    ├── Step 3: Select Model
    │       Radio cards with thumbnails
    │       Filtered by gender (from Step 1)
    │
    ├── Step 4: Select Pose
    │       Radio cards with thumbnails
    │
    ├── Step 5: Select Background
    │       Radio cards with thumbnails
    │
    ├── Step 6: Select Lower Garment
    │       Radio cards, filtered by gender/subcategory
    │
    └── Generate Button → POST /v1/jobs/tryon
                       → SSE progress: Queued → Processing → Done
                       → Result image rendered with download option
```

---

## 8. Updated API Routes

### User-Facing

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/auth/register` | — | Register |
| `POST` | `/v1/auth/login` | — | Login, returns tokens |
| `POST` | `/v1/auth/refresh` | Cookie | Refresh access token |
| `POST` | `/v1/auth/logout` | JWT | Revoke refresh token |
| `GET` | `/v1/credits` | JWT | Balance + recent ledger |
| `GET` | `/v1/catalog/:type` | JWT | List catalog items (with category tree) |
| `POST` | `/v1/uploads/presign` | JWT | Presign garment upload URL |
| `POST` | `/v1/jobs/tryon` | JWT | Create job |
| `GET` | `/v1/jobs` | JWT | List own jobs |
| `GET` | `/v1/jobs/:id` | JWT | Job detail |
| `GET` | `/v1/jobs/:id/events` | JWT | SSE stream |
| `GET` | `/v1/jobs/:id/result` | JWT | Signed result URL |

### Admin-Facing (`/admin/*` — requires Admin JWT)

See Section 5.2 for full table.

---

## 9. Monorepo Structure (Updated)

```
/
├── apps/
│   ├── web/             Next.js 15 — user UI + admin panel routes
│   ├── api/             Fastify — all user + admin endpoints
│   └── dispatcher/      Node.js — Redis consumer, ComfyUI bridge, health monitor
├── packages/
│   ├── types/           Shared TypeScript types + Zod schemas
│   ├── db/              Drizzle ORM schema + migrations
│   ├── storage/         StorageProvider interface + R2 implementation
│   └── catalog/         Catalog query helpers (category tree builder)
├── infra/
│   ├── docker-compose.yml
│   ├── cloudflared/     Tunnel config templates for worker VPS
│   └── comfyui/         Hostinger VPS setup scripts + model manifest
├── templates/
│   └── virtual-tryon-v1.json
├── scripts/
│   └── seed-catalog.ts  Bulk seed initial catalog items from a manifest JSON
├── pnpm-workspace.yaml
└── .env.example
```

---

## 10. Environment Variables (Updated)

```env
# Cloudflare Tunnel / Workers
WORKER_A_URL=https://worker-a.tryon.yourdomain.com
WORKER_B_URL=https://worker-b.tryon.yourdomain.com
CF_ACCESS_CLIENT_ID=<cloudflare-zero-trust-service-token-id>
CF_ACCESS_CLIENT_SECRET=<cloudflare-zero-trust-service-token-secret>

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=virtual-tryon-prod
R2_PUBLIC_URL=https://assets.tryon.yourdomain.com   # custom domain on R2 bucket

# Database / Cache
DATABASE_URL=postgres://tryon:password@127.0.0.1:5432/tryon_prod
REDIS_URL=redis://127.0.0.1:6379

# Auth
JWT_SECRET=...
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Admin
ADMIN_BOOTSTRAP_EMAIL=admin@yourdomain.com   # first admin seeded on deploy
```

---

## 11. Security Layers (Updated)

| Layer | Tool | Coverage |
|---|---|---|
| Edge | Cloudflare Free | DDoS, OWASP WAF, rate limiting, SSL, CDN |
| Worker access | Cloudflare Zero Trust Service Token | ComfyUI never publicly reachable |
| Transport | HTTPS everywhere via tunnel | No open ports on ComfyUI VPS |
| Auth | JWT access (15min) + httpOnly refresh (7d) | Session security |
| Admin auth | Separate admin role in JWT + DB check | All /admin routes double-verified |
| Input validation | Zod schemas on all endpoints | Malformed request rejection |
| Catalog validation | All catalog IDs verified active before job creation | Invalid/disabled item rejection |
| SQL safety | Drizzle ORM parameterized queries | SQLi prevention |
| File uploads | Magic bytes + size (10MB) + dimension checks | Malicious file prevention |
| Headers | Helmet.js | CSP, HSTS, X-Frame-Options |
| Rate limiting | fastify-rate-limit | Per-user and per-IP |
| Internal services | Postgres + Redis bind to 127.0.0.1 only | No external exposure |
| Prompt | Injection guard on user hint field | Protect system prompt integrity |
| Force logout | Refresh token revocation table | Admin can terminate any session |

---

## 12. Sprint Plan (Updated)

| Week | Deliverables |
|---|---|
| **Week 1** | Monorepo init, Docker Compose, Drizzle schema (incl. catalog + admin tables), JWT auth + admin roles, credit ledger, R2 StorageProvider, Cloudflare tunnel setup on dev VPS |
| **Week 2** | Catalog API (browse, category tree), job creation with catalog ID resolution, Redis Stream publisher, Dispatcher with tunnel-based worker routing + health monitor, retry logic |
| **Week 3** | SSE job events, Next.js user UI (upload + catalog picker + job dashboard + result viewer), Admin panel (catalog CRUD, user management, credit controls) |
| **Week 4** | End-to-end integration, Hostinger prod VPS setup + tunnel registration, load testing (2-worker queue), admin panel polish, bug fixes, v1 launch |

---

## 13. Open Decisions (Deferred to v2)

| Item | Notes |
|---|---|
| Stripe payments | Free credits at launch; Stripe + pro tier in v2 |
| Thumbnail auto-generation | v1: admin uploads both; v2: server-side Sharp resize on catalog upload |
| Catalog search/filter | v1: category tree only; v2: full-text search across catalog items |
| CDN for catalog assets | v1: R2 presigned URLs; v2: public R2 bucket with custom domain for catalog thumbnails |
| Auto-scale worker VPS | v1: 2 fixed workers; v2: script to provision additional Hostinger VPS on queue depth threshold |
| Virus scanning | ClamAV on garment uploads |
| Monitoring | Grafana + Prometheus for GPU util, queue depth, job latency |
| Error tracking | Sentry for production stack traces |
| Native HF pipeline | HuggingFace diffusers port of Qwen-Image-Edit (replaces ComfyUI) |

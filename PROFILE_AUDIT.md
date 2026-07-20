# AI Vastra — Contribution Audit

**Method:** Full git history analysis (1031 total commits, 2026-05-18 → 2026-07-16). Author identity confirmed by the repository owner as three git identities that all map to the same person:
`manikantagunnam.nicedigitals@gmail.com`, `adeshboudh.nicedigitals@gmail.com`, `adeshboudh1@gmail.com` — **376 commits**, **274,533 insertions / 79,676 deletions** across those commits.

A separate identity (`adeshboudh@gmail.com`, 651 commits — e.g. the Resend email integration, `apps/api/src/lib/mailer.ts`) was explicitly **not** confirmed as this person and is excluded from all claims below. Where a claim would rely on that identity's work, it is stated as "exists in the repo, not attributable to you" rather than claimed.

---

## 1. What is AI Vastra?

An AI virtual try-on SaaS platform. Users upload a garment image; the system composites it onto admin-curated model photos (face/pose/background) via ComfyUI-based generative image workflows, returning catalogue-ready product images. It serves three audiences: direct web users (credit-based), e-commerce merchants (widget embed + API), and kiosk/retail deployments. Evidence: `docs/virtual-tryon-system-design.md`, `CLAUDE.md`, and the module structure below.

## 2. Which modules exist?

From the monorepo (`apps/*`, `packages/*`) as of the current tree, plus modules visible only in history (renamed/retired):

- **Active:** `apps/api`, `apps/dispatcher`, `apps/catalogues-web`, `apps/admin-web`, `apps/chatbot`, `packages/db`, `packages/types`, `packages/storage`, `packages/logger`, `packages/observability`
- **Retired/renamed (seen in your commits):** `apps/web` (early name, → `apps/catalogues-web`), `apps/admin` (early name, → `apps/admin-web`), `apps/merchant-web` (built, later removed — "chore(merchant-web): remove undeployed legacy app entirely"), `apps/admin-mobile` (scaffolded, now paused per CLAUDE.md), `apps/virtual-tryon-mobile&kiosk_latest` (mobile/kiosk client)

## 3. Backend modules you contributed to (evidence: commit scope tags + file paths)

`apps/api/src/modules/*` — commit counts touching each:

| Module | Your commits touching it |
|---|---|
| admin | 91 |
| jobs | 51 |
| merchant | 23 |
| auth | 21 |
| kiosk | 14 |
| widget | 11 |
| models | 11 |
| payments | 7 |
| results | 5 |
| credits | 5 |
| catalog | 5 |
| uploads | 4 |
| support | 1 |

`apps/dispatcher/src/*`: workflow (32), job (30), stream (14), worker (10), comfyui (6), lib (4), health (1) — i.e. you touched every dispatcher subsystem: the Redis Stream consumer, worker selection/health, the ComfyUI HTTP+WS client, and workflow template patching.

## 4. Frontend modules you contributed to

- `apps/catalogues-web` — 234 files across commits, including the Studio wizard (`feat(studio)`, `fix(studio)`, `fix(web)` UX fixes ×23), auth BFF routes, design tokens.
- `apps/admin-web` — 172 files; you built large parts of the admin SPA: workers, workflows, catalogue templates, pose assets, dashboard.
- `apps/web` / `apps/admin` (pre-rename versions) — 276 / 112 files respectively, i.e. you worked on these apps before and through their rename.
- `apps/merchant-web` — 159 files (built, then you authored its removal).
- `apps/admin-mobile` — 182 files (scaffolded early; per CLAUDE.md this app is now paused — do not claim ongoing work here).
- `apps/virtual-tryon-mobile&kiosk_latest` — 251 files (kiosk/mobile client).

## 5. APIs you created or significantly modified

Representative, evidence-backed (commit subjects, not inferred):
- `feat(api): auth register/login/refresh/logout with argon2id + jwt + refresh rotation` (initial auth API)
- `feat(auth): refresh token families with FOR UPDATE concurrency fix`, and the follow-up fix for 15-min logout / revocation bugs
- `feat(api): SSE job events via redis pub/sub with 15s heartbeat`
- `feat(api): add regenerate endpoint` (`POST /v1/jobs/:id/regenerate`)
- `feat(api): widget rate limiting and bounded Redis streams`
- `feat(api): add GET/PATCH garment-type shot-type-workflow default routes`
- `fix(api): GET /v1/assets 500s when a user has 2+ garment uploads`
- `fix(api): close widget upload size bypass with headObject gate`
- `fix(api): SSRF guard (assertSafeExternalUrl)`, rate limiting (register, merchant signup), Redis-backed rate-limit store, `requireUser` token-kind assertion, constant-time dummy hash on unknown-user login — full security hardening pass (see §16)
- Admin CRUD surface: 91 commits touching `apps/api/src/modules/admin/*` (workers, workflows, catalog, users, credits, merchant management)

## 6. Database models you designed or modified

`packages/db/src/schema/*.ts` touched by you: `models.ts` (16 commits), `jobs.ts` (8), `users.ts` (7), `widget.ts` (5), `index.ts` (5), `credits.ts` (5), `merchant.ts` (3), `kiosk.ts` (3), `admin.ts` (2), `workers.ts`, `contact.ts`, `catalog.ts`.

**78 of your commits added a migration file** (`packages/db/src/migrations/[0-9]*`) — i.e. you are responsible for the majority of the schema's evolution: initial jobs/credits/auth tables, the workflow_templates system, widget/merchant tables, shot-type tagging, and multiple migration-chain repairs (`fix(db): repair broken migration snapshot chain`, dedup fixes using `ctid`/`DISTINCT ON` for a `MIN(uuid)`-unsupported case).

## 7. Workflows you implemented

- ComfyUI workflow template system end-to-end: DB schema → admin CRUD → dispatcher patching (`feat: workflow templates — DB, API, admin UI, dispatcher integration`)
- Convention-based workflow node auto-detection (`feat: convention-based workflow node auto-detection, drop faceFrontNodeId`)
- Flexible workflow roles (multi-day feature, `docs/specs` + `docs/plans` design docs through 3 revisions, then DB/types/API/admin-web implementation) — lower/inner-only workflows, optional face/background roles
- Shot-type default workflows (garment-type-level auto-resolution of pose workflows)
- Per-pose prompt override on catalogue-template workflow mappings
- Dispatcher `finalizeOutput()` refactor — deduplicated the download→upload→thumbnail→COMPLETED logic shared by 3 job processors
- Watermarking pipeline (opacity/tiling/compositing fixes, asset-kind gating)

## 8. Authentication features

- Initial auth API: register/login/refresh/logout, argon2id password hashing, JWT, refresh token rotation
- Refresh token **family rotation** with `FOR UPDATE` concurrency handling (race-condition fix)
- Fixed a 15-minute forced-logout bug, broken logout revocation, and cookie-expiry mismatch
- Google OAuth state-cookie TTL fix
- Security hardening on auth: `requireUser` now rejects non-access-kind tokens (M5), constant-time dummy hash for unknown-user login to prevent user enumeration timing attack (M6), password policy + TLS guard (types/dispatcher)
- Web-side: moved `access_token` off a JS-readable cookie into in-memory module state with silent re-hydration via httpOnly refresh cookie (H2 hardening)

Email verification / password reset via Resend exists in the repo but was authored by the other, unconfirmed identity — **not claimed here**.

## 9. Deployment activities

- `chore: trigger deployment`, `chore: trigger redeployment`, `chore: trigger deploy` commits — you triggered production deploys
- `fix: production deployment fixes — dispatcher, web, api, admin` — cross-service prod fix
- CI/CD: renamed `test.yml` → `ci.yml`, gated deploy on lint/typecheck/tests passing and removed a separate `deploy.yml`, fixed `.github/workflows` migration container env-var wiring (`DATABASE_URL` with postgres service name, `--env-file` handling), fixed `git pull` → `reset --hard` in prod migrate scripts
- `fix(web): disable Next.js build-time ESLint to unblock Docker CI`

## 10. VPS / server work

- `infra/docker-compose.prod.yml`, `infra/docker-compose.yml` — touched directly by you (production and dev compose)
- `infra/cloudflared/config.example.yml`, `infra/cloudflared/README.md` — Cloudflare Tunnel config for the no-inbound-ports GPU worker architecture
- `infra/postgres/init/01-extensions.sql`
- `chore(infra): drop merchant service from prod compose, no subdomain yet`
- `fix(admin): drop /panel basename, admin now lives at its own subdomain`
- Prod migration script fixes described above (§9) are direct VPS/CI deployment-pipeline work

## 11. GitHub workflows you created or modified

`.github/workflows/ci.yml`, `deploy.yml`, `test.yml` all appear in your file list. Commit-level evidence: renamed `test.yml`→`ci.yml`, added deploy gating on lint/typecheck/tests, removed redundant `deploy.yml`, excluded `admin-mobile` from pre-push typecheck.

## 12. Production bugs you fixed

A representative sample (60+ `fix()` commits total; this is not exhaustive — see git log for the full list):
- `GET /v1/assets` 500 error for users with 2+ garment uploads
- Widget upload size-limit bypass (missing `headObject` gate)
- Broken migration snapshot chain (`0100 prevId`) and journal renumbering
- `credit_ledger` duplicate rows blocking a unique index (custom `ctid`+`DISTINCT ON` dedup, since `MIN(uuid)` isn't supported in Postgres)
- Redis worker registry leaking stale entries not present in DB on dispatcher startup
- Kiosk job processing misalignment with the main job pipeline
- Regenerate endpoint duplicating job-creation logic instead of reusing it
- Watermark opacity/tiling/compositing bugs
- 15-minute forced logout / broken logout revocation (auth)

## 13. Architecture decisions attributable to you

- Authored the garment taxonomy & generation pipeline architecture spec (`docs/virtual-tryon-system-design.md` lineage) replacing a boolean `requiresLowerUpload` + saree-only columns with a real workflow-role taxonomy — explicitly scoped to keep runtime resolution deterministic and admin-explicit rather than capability-flag-driven
- Designed the "flexible workflow roles" system through 3 documented design revisions (`docs/specs`, `docs/plans`) before implementation — evidence of design-first practice, not just coding
- Convention-based ComfyUI node auto-detection (reduces manual admin config)
- `finalizeOutput()` extraction — architectural deduplication across 3 job-processing code paths in the dispatcher

## 14. Complex engineering problems solved

- Refresh-token race condition under concurrent requests, fixed with `FOR UPDATE` row locking
- Postgres migration-chain corruption recovery (snapshot chain repair, journal hash gap handling)
- `credit_ledger` deduplication where the natural fix (`MIN(uuid)`) isn't valid SQL — worked around with `ctid` + `DISTINCT ON`
- SSRF prevention requiring HTTPS-only + DNS resolution + RFC1918 private-range blocking (`assertSafeExternalUrl`)
- Cross-tab auth token sync via `BroadcastChannel` after moving tokens out of cookies

## 15. Performance / scale-related work

- Bounded Redis Streams for widget rate limiting (prevents unbounded stream growth)
- Redis-backed distributed rate-limit store (vs. in-memory, correct across multiple API instances)
- 3-tier job queue priority via `credit_plans`
- SSE heartbeat tuning (15s) for job progress streaming

*(No load-testing or profiling artifacts found in the repo — do not claim quantified performance gains without further evidence.)*

## 16. Security improvements you implemented

Two large, explicitly-labeled hardening passes, each with a security-audit ID scheme (evidence: commit bodies quoted verbatim):

**API side** (`fix(api): security hardening — C2/C3/H1/M1-M7`):
C2 SSRF guard; C3 results-token requires active admin status; H1 merchant signup rate-limited 5/hr with widgetKey withheld until active; M1 register rate-limited 10/min; M2 Redis-backed rate-limit store; M3 `allowedOrigins` enforcement in widget-auth plugin; M4 merchant cookie scoped + shortened to 7d; M5 `requireUser` rejects non-access tokens; M6 constant-time dummy hash against user-enumeration timing attacks; M7 raw errors logged internally, generic messages returned externally.

**Web/infra side** (`fix(web,infra): security hardening — H2/H3/L1-L5`):
H2 access_token moved from cookie to in-memory JS state; H3 removed anonymous MinIO bucket listing, switched to presigned GET URLs (1h TTL); L1 refresh-token expiry set explicitly; L2 CORS narrowed to explicit origins; L3 placeholder HTTPS URL in env example; L5 security headers added (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`).

Plus a separate a11y/tech-debt security audit pass on the web app.

## 17. Integrations

| Integration | Your involvement |
|---|---|
| Google (OAuth) | OAuth state-cookie TTL fix; broader OAuth flow exists in `oauth_accounts` schema which you also touched |
| Email (Resend) | **Not attributable to you** — built by the other git identity |
| Storage (R2/MinIO, S3-compatible) | Contributed to `packages/storage` (15 files); presigned URL security fix (H3) |
| Redis | Streams consumer, pub/sub SSE, rate-limit store, worker registry — extensive (§7, §16) |
| Queue (Redis Streams `jobs:priority`/`jobs:normal`) | Priority-aware consumer, bounded streams, 3-tier priority via credit_plans |
| ComfyUI | HTTP client (submit/history/download), WebSocket progress listener, workflow template patcher, test-harness mock |
| MinIO | Removed anonymous public access as part of hardening; dev-parity with R2 |
| Cloudflare (Tunnel) | `infra/cloudflared` config for no-inbound-port GPU worker connectivity |
| Razorpay (Payments) | `feat: Razorpay payments, resolution pricing`, admin-controlled credit plans via DB |
| Sentry | `feat: payments, job streaming, and sentry integration` |

## 18. AI/image-generation workflows you built

Covered in §7. Summary: the full ComfyUI workflow-template lifecycle (schema, admin authoring UI, dispatcher runtime patching), convention-based node auto-detection, flexible/optional garment roles (lower-only, inner-only), shot-type default resolution, per-pose prompt overrides, and watermarking.

## 19. Admin features you implemented

91 commits touching `apps/api/src/modules/admin/*`, plus 172 files in `apps/admin-web`. Concrete features: workers management, workflow template CRUD + validation (including merged-shape validation on PATCH), catalogue-template pose-workflow mapping UI, pose assets management, dashboard rework with grouped nav and accurate queue depth, merchant grant/edit admin flow, credit adjustment, direct pose upload with inline workflow mapping.

## 20. Customer-facing features you implemented

Studio wizard UX (template/pose selection fixes), lower/shoe catalog options in the studio, regenerate flow, catalogues/assets browsing (including excluding try-on-derived jobs from browse views), support form, contact-us page fixes, resolution-based pricing.

## 21. Internal tools you built

Admin dashboard (queue depth, grouped nav), credit-plan admin controls, workflow auto-detect tooling, pose-asset filtering tools. `scripts/bootstrap-admin.ts` and `scripts/migrate-face-bg-keys.ts` appear in your file list (2 touches each) — admin bootstrap and a one-off data migration script.

## 22. DevOps responsibilities visible

CI pipeline design and gating (§11), production deploy triggering (§9), prod docker-compose maintenance (§10), migration-pipeline debugging in CI containers, Cloudflare Tunnel config, lint/typecheck pre-push gate maintenance (fixing blockers it surfaced, excluding paused apps from it).

## 23. Technologies demonstrated

TypeScript (ESM), Node.js, Fastify 5, Zod, Drizzle ORM, PostgreSQL, Redis (Streams + pub/sub + rate limiting), Next.js 15, React, Vite, pnpm workspaces/monorepo, Docker Compose, Cloudflare Tunnel, S3-compatible object storage (R2/MinIO), ComfyUI (WebSocket + HTTP), Razorpay, Sentry, argon2id, JWT, GitHub Actions.

## 24. Engineering skills demonstrated

Schema design and migration management at scale (78 migrations), concurrency-safe transactional design (credit deduct + job insert, refresh-token row locking), security-first API design (documented, ID-tracked hardening passes), incident/bug root-causing (auth logout bug, migration chain corruption, dedup edge cases), design-before-code discipline (multi-revision specs before flexible-workflow-roles implementation), full-stack ownership (DB → API → dispatcher → admin UI → customer UI for the same features), CI/CD pipeline ownership.

## 25–26. Resume / LinkedIn — see bullets below

## 27. Interview questions this repo would naturally raise

- "Walk me through the refresh-token race condition and how `FOR UPDATE` fixed it."
- "Why did you move the access token out of a cookie into memory — what attack does that stop, and what did it cost you (re-hydration, cross-tab sync)?"
- "How does your SSRF guard work, and what's still not covered?"
- "You migrated a schema 78 times — describe a time the migration chain broke and how you diagnosed/repaired it."
- "Why was `MIN(uuid)` not usable for the credit_ledger dedup, and what did you do instead?"
- "Describe the dispatcher's job-processing pipeline and why you extracted `finalizeOutput()`."
- "How does your rate limiting stay correct across multiple API instances?"

## 28–29. Full Stack vs. Backend Engineer responsibility mapping

**Full Stack responsibilities evidenced:** Studio wizard UX, admin SPA feature builds, Next.js middleware/auth BFF, API route design, DB schema design, dispatcher/worker orchestration — you worked the entire stack, not one layer.

**Backend-specific responsibilities evidenced:** Auth system (JWT/argon2/refresh rotation), credit/payment transactional integrity, Redis queue architecture, ComfyUI dispatcher integration, security hardening (SSRF/rate-limiting/token validation), migration/schema ownership.

---

## 30. Summary Blocks

### Technologies
TypeScript, Node.js, Fastify, Next.js, React, PostgreSQL, Drizzle ORM, Redis, Docker, Cloudflare Tunnel, S3/R2/MinIO, ComfyUI, Razorpay, Sentry, GitHub Actions, Zod, pnpm monorepo.

### Responsibilities
End-to-end feature ownership (DB → API → dispatcher → admin/customer UI) on an AI image-generation SaaS platform; authentication and security hardening; CI/CD and production deployment; schema design and migration management; production bug triage and root-cause fixes.

### Features
Auth (register/login/refresh-rotation/OAuth), credits/payments (Razorpay), job queueing and SSE progress, ComfyUI workflow-template system with auto-detection and flexible roles, admin panel (workers/workflows/templates/dashboard), Studio try-on wizard, watermarking, catalogue/asset browsing.

### Architecture
Three-service split (api / dispatcher / web) around a Redis Stream boundary; Cloudflare Tunnel for inbound-port-free GPU workers; garment-taxonomy redesign moving from boolean flags to a role-based workflow system; deduplicated dispatcher job-finalization path.

### DevOps
GitHub Actions CI/CD (lint/typecheck/test gating before deploy), production docker-compose maintenance, migration-pipeline fixes in CI, Cloudflare Tunnel config, admin subdomain cutover.

### Database
Primary contributor to schema evolution — 78 migrations across auth, jobs, credits, models, widget, merchant, kiosk domains; multiple migration-chain repair incidents resolved.

### APIs
Built or substantially modified auth, jobs (incl. SSE, regenerate), admin (largest single surface), merchant, widget, models, payments, and catalog API modules.

### Production responsibilities
Triggered production deployments; fixed cross-service production incidents; ran two dedicated security-hardening passes covering SSRF, rate limiting, token validation, and CORS; repaired production migration/CI pipeline failures.

### Business impact
Enabled three revenue surfaces (direct-consumer credits, merchant API/widget, kiosk) on a shared backend; closed a widget upload size-limit exploit and an SSRF vector before they reached merchant integrations; reduced admin manual workflow-config effort via convention-based node auto-detection.

*(No metrics — conversion, revenue, uptime — exist in the repo. Do not state quantified business impact without a source for those numbers.)*

### Resume bullets
- Designed and evolved a PostgreSQL schema (Drizzle ORM, 78 migrations) for an AI image-generation SaaS spanning auth, credits, job orchestration, and a ComfyUI workflow-template system.
- Built the authentication system (Fastify, argon2id, JWT, refresh-token family rotation with row-level locking) and led two security-hardening passes covering SSRF prevention, rate limiting, and token validation.
- Owned end-to-end feature delivery across a 3-service architecture (Fastify API, Redis-Stream dispatcher, Next.js frontend), including a Redis Streams-based job queue with SSE progress and priority tiers.
- Implemented CI/CD gating (GitHub Actions) and maintained production Docker Compose / Cloudflare Tunnel infrastructure for a GPU-worker fleet with no inbound ports.
- Diagnosed and repaired production incidents including a refresh-token race condition, a corrupted Postgres migration chain, and a widget file-upload size-limit bypass.

### LinkedIn bullets
- Full-stack engineer on an AI virtual try-on platform — owned features from database schema through ComfyUI dispatcher logic to the admin and customer-facing UI.
- Led security hardening across the API and web app: SSRF protection, rate limiting, token-scoping fixes, and moving auth tokens off client-readable cookies.
- Built the credit/payments system (Razorpay) and a priority-based Redis Streams job queue powering real-time generation status via SSE.
- Designed and shipped a flexible ComfyUI workflow-template system supporting optional garment roles, replacing a rigid boolean-flag model.

### Portfolio description
AI Vastra is a virtual try-on SaaS platform where users upload a garment and receive AI-generated catalogue images via ComfyUI, serving direct consumers (credit-based), e-commerce merchants (widget/API), and kiosk deployments. I worked across the full stack — Postgres/Drizzle schema design (78 migrations), a Fastify API (auth, credits, admin, jobs), a Redis-Stream job dispatcher that talks to GPU ComfyUI workers over Cloudflare Tunnel, and the Next.js customer app and admin SPA — including two dedicated security-hardening passes (SSRF prevention, rate limiting, token handling) and CI/CD pipeline ownership.

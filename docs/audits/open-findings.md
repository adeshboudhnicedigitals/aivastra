# Open Findings — Consolidated Backlog

**Last updated:** 2026-08-12  
**Status:** This document tracks only findings that are still open — a fully resolved finding is removed from here, not kept as a ✅ entry. Check `git log -p -- docs/audits/open-findings.md` for the history of anything removed. It consolidates open items from `docs/security-production-audit.md` (SEC-*) and `docs/production-backlog-hardening.md` (PIPE-*) in addition to the original mobile and platform findings.

**2026-08-12 sweep:** every remaining item as of the prior version was re-checked against current code. 22 were already fixed (18 mobile, 4 platform) and removed here — see git history for what they were. Two mobile items and one platform item survived the sweep as genuinely still open or partial; everything in Part 3 was already known-current from today's session.

---

## Part 1 — Admin Mobile (apps/admin-mobile)

> All P0/P1 findings and 18 of 20 P2/P3 findings have been resolved. Two remain open.

### 🟡 P2 — Medium / Quality

#### P2-9 · `uploadTwoImage` orphans main image when thumbnail upload fails
**File:** `src/lib/upload.ts` (lines 39–60)

If the main image uploads to R2 successfully but thumbnail generation or upload fails, the function throws without calling `confirmEndpoint`. The main image is permanently orphaned in R2. Confirmed still open 2026-08-12 — every caller (`assets/backgrounds`, `assets/catalog`, `assets/faces`, `more/saree.tsx`, `more/tryon.tsx`) wraps the call in a generic `catch` with no cleanup call.

**Fix:** Catch thumbnail failure and call a delete endpoint, or rely on a 24-hour R2 lifecycle rule for unconfirmed uploads.

---

### 🔵 P3 — Low / Polish

#### P3-2 · No automated version/build number bump in CI
**File:** `apps/admin-mobile/app.config.js` (line 9)

Manual version bumping in a fast-moving repo is error-prone. Play Store and TestFlight reject duplicate build numbers. Confirmed still open 2026-08-12 — `app.config.js` still hardcodes `version: '1.0.1'`.

**Fix:** Use `appVersionSource: "remote"` (EAS) or a pre-build hook reading from `git describe`.

---

## Part 2 — Platform / Web / API

### 🔴 Critical

#### 7.5 / 9.1 · ComfyUI Arbitrary Payload Execution + Dispatcher Hardening
**Severity:** Critical  
**Files:** `apps/dispatcher/` (architectural)

The dispatcher forwards job inputs to ComfyUI without enforcing a strict input schema. If any user-controlled value (hint text, node IDs from the API) leaks into arbitrary ComfyUI node connections, it enables prompt injection or RCE on GPU workers. The dispatcher is also prototype-grade — single-node orchestration, no graceful abort, no sandboxed execution.

**Required before production GPU traffic:**
- Strict allowlist schema for every field forwarded to ComfyUI nodes — no passthrough of raw user strings beyond the sanitized hint
- Network-isolated ComfyUI workers (already tunneled via Cloudflare; verify no LAN reachability)
- Dispatcher multi-node orchestration (currently routes to one worker type only)
- Graceful abort path for in-flight jobs on cancellation

---

### 🔴 High

#### 7.1 · Widget Origin Validation / API Key Abuse
**Severity:** High  
**File:** `apps/api/src/modules/widget/widget.routes.ts`

Public widget API keys are static strings. Outside a browser, `Origin` headers are trivially spoofed via `curl`. A merchant's public key can be used to drain their credits from any script. Confirmed still open 2026-08-12 — no Turnstile/reCAPTCHA or signed-session-token code found anywhere in the widget module or web app.

**Options (requires product decision):**
1. **reCAPTCHA v3 / Cloudflare Turnstile** — browser-only challenge; add token verification before credit deduction
2. **Server-signed session tokens** — merchant's backend calls a signing endpoint with the secret key; widget receives a short-lived JWT; API validates JWT instead of raw public key

Both options require coordinated changes to the widget embed, the merchant's integration docs, and the API. High implementation complexity — needs a design session before implementation.

---

### 🟠 Medium

#### 2.3 · Merchant Analytics Dashboard
**Severity:** Medium  
**Complexity:** High

No per-merchant analytics surface exists. Merchants can't see their job volume, success rate, credit burn rate, or output gallery without contacting support. Requires a new API aggregate endpoint and a web UI page. Defer to a dedicated sprint. Confirmed still open 2026-08-12 — no merchant-scoped analytics route in `apps/api/src/modules/merchant/`. (The Shopify `/v1/shopify/analytics` route is a different, store-scoped surface and doesn't cover this.)

---

#### 2.4 · Idempotency Key on `POST /v1/widget/jobs`
**Severity:** Medium  
**Complexity:** Medium  
**File:** `apps/api/src/modules/widget/widget.routes.ts`

No idempotency protection on job creation. A double-submit (network retry, accidental re-click) creates two jobs and deducts credits twice. Confirmed still open 2026-08-12 — no `Idempotency-Key` handling in the route.

**Fix:** Accept an optional `Idempotency-Key` header; cache the response keyed on `(clientId, idempotency-key)` in Redis for 24h; return the cached response on duplicate.

---

#### 4.3 · Hardcoded Responsive Breakpoints
**Severity:** Medium  
**Complexity:** High  
**Files:** `apps/catalogues-web/src/app/globals.css`, multiple component files

Responsive layout breakpoints are scattered as magic pixel values (`768px`, `1024px`, `1280px`) across CSS media queries and inline style conditionals. No shared breakpoint tokens. Changing the layout grid requires hunting every file. Confirmed still open 2026-08-12 — no `--bp-*` tokens or `breakpoints.ts` file exist.

**Fix:** Define `--bp-sm`, `--bp-md`, `--bp-lg` CSS custom properties in `:root` and reference them via `@media (min-width: var(--bp-md))` or a shared `breakpoints.ts` constant file.

---

#### 8.2 · DB Migration Index Conflict Risk
**Severity:** Medium  
**Complexity:** High  
**Files:** `packages/db/src/migrations/`

When two branches independently add migrations, they collide on the same `NNNN_` index. The resolution process (rename, re-journal, manual apply-one) is manual and error-prone, and remains documented in `CLAUDE.md`/`docs/version-control.md` but not automated. Confirmed still open 2026-08-12 — no such check in `.github/workflows/ci.yml` or `scripts/ci/`.

**Fix:** A pre-push CI check that verifies the highest local migration index is greater than the highest index on `origin/dev`. Fail fast with a rename instruction rather than discovering the collision post-merge.

---

#### 9.4 · DB Seeding Standardization
**Severity:** Medium  
**Complexity:** Medium  
**File:** `packages/db/src/seed.ts`

**Status:** 🟡 Partial — re-checked 2026-08-12. `pnpm db:seed` now exists and runs `packages/db/src/seed.ts` (the standalone `scripts/seed-catalog.ts` this finding originally cited no longer exists), but the script only seeds catalog types/categories/2000 faker catalog items. It doesn't touch an admin user or sample workflow templates, so a genuinely fresh dev environment still needs manual setup beyond `pnpm db:seed` for those two things.

**Fix:** Extend `seed.ts` to also seed a default admin user and a minimal workflow template, or document the remaining manual steps in `CLAUDE.md`.

---

#### 1.4 · BFF Proxying Overhead for Non-Auth Routes
**Severity:** Medium  
**Complexity:** High  
**Files:** `apps/catalogues-web/src/app/api/`

Some non-auth API calls route through the Next.js BFF (adding an extra network hop) when they could call the Fastify API directly. Architectural — requires auditing each BFF route to categorise: auth-only (keep BFF), data fetch (call API directly from client), sensitive (keep BFF). Defer to a dedicated refactor sprint. Not independently re-verified 2026-08-12 (architectural, unlikely to have changed incidentally) — treat as still open.

---

### 🟢 Low

#### 11.3 · Fragmented Admin Styling
**Severity:** Medium  
**Complexity:** High  
**File:** `apps/admin-web/src/`

The admin SPA has no shared component library for the general case — buttons, cards, and most modals are re-styled inline across pages, though `StatusBadge.tsx` and `JobTypeBadge.tsx` now exist as a start. Design drift is visible (inconsistent padding, border-radius, font sizes between pages). Requires an incremental extraction of shared components — no big-bang rewrite, but each new page/feature should pull from a growing `components/` library.

---

---

## Part 3 — Security Audit & Pipeline Hardening (Open Items)

> Source: `docs/security-production-audit.md` and `docs/production-backlog-hardening.md`.
> All code-fixable items in both documents have been resolved. What remains are items that require an ops action, a product decision, or a non-trivial architectural change.

---

### 🔴 Critical / High — Security

#### SEC-C1 · Leaked VPS credential still in git history
**Severity:** High (ops action) — rotation confirmed 2026-08-12; downgraded from Critical now that the live credential is dead, but the repo is public so the historical value is still exposed
**Status:** 🟡 Partial — **rotated on the VPS 2026-08-12**, confirmed by the user; git history still not purged
**File:** `.env.production.example` (commit `619622e`)

The real ComfyUI Basic-Auth password for the widget VPS (`WIDGET_COMFYUI_URL=http://38.247.186.118:8339`) was committed and remains in git history even after the file was updated with a placeholder. **Confirmed rotated 2026-08-12** — the leaked value no longer authenticates against that VPS. The repo went public the same day for GitHub branch-protection reasons (see `docs/progress.md`), so the dead credential is still readable by anyone via `git show 619622e:.env.production.example`, and the history should still be cleaned up.

**Remaining ops actions (in order):**
1. Purge from history with `git filter-repo` (replace the leaked value with a placeholder across all commits), then force-push all remotes. Coordinate with anyone else who has a local clone — history rewrite invalidates their branches.
2. Add a pre-commit secret scanner (gitleaks / trufflehog) to CI so this class of leak is caught automatically before it's committed.

---

#### SEC-H2 · `access_token` cookie is JS-readable; no CSP
**Severity:** High
**Status:** ✅ Fixed (2026-06-30) — token moved to memory; CSP still open
**File:** `apps/catalogues-web/src/lib/auth-cookies.ts:9`, `apps/catalogues-web/next.config.ts`

Access token moved out of cookies entirely into a module-level variable in `apps/catalogues-web/src/lib/api.ts`. `setAuthCookies` no longer sets `access_token`. Login BFF returns `{ ok, accessToken }` in the JSON body; the login page calls `initToken(accessToken)` to seed module memory. On page reload the first 401 triggers `tryRefresh()` which silently re-hydrates from the `httpOnly` refresh cookie. BroadcastChannel syncs the token across tabs. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` added (L5 fix).

**Remaining:** CSP header not yet added to `next.config.ts` — requires auditing all script/style/connect origins first.

---

#### SEC-H3 · Object storage bucket is world-readable
**Severity:** High
**Status:** ⚠️ Partially fixed — live prod bucket is still world-readable
**File:** `infra/docker-compose*.yml` (`mc anonymous set download`)

`mc anonymous set download` was removed from both `docker-compose.yml` and `docker-compose.prod.yml`, and `/admin/results/data` now serves its private content via presigned GET URLs (1 h TTL) — `garmentUrl`, `poseUrl`, `backgroundUrl`, `lowerUrl`, `shoeUrl`, `outputUrl` all use `app.storage.presignGet(key, 3600)` instead of `publicUrl()`. That part is real and correct.

**What's still open (found 2026-08-07, staging environment build-out):** removing the line from the compose file only stops a *newly created* bucket from getting the public policy — it does not revoke an already-applied MinIO bucket policy on an existing bucket. Prod's live bucket was created before this fix landed and is still `mc anonymous set download` (world-readable) today, grandfathered. This was only discovered because staging's bucket, created fresh after the fix, never got the policy and every `publicUrl()`-based image 404'd until it was manually re-applied to match prod's actual behavior.

The previous version of this note claimed curated catalog/pose thumbnails "are served via presigned URLs on demand — no separate public prefix needed." That's inaccurate: `apps/api/src/modules/models/routes.ts`, `catalog/routes.ts`, `catalog-options/build.ts`, `subcategories.routes.ts`, `backgrounds/routes.ts`, `admin/catalog.routes.ts`, `admin/catalogue-templates.routes.ts`, `admin/config.routes.ts`, `admin/users.routes.ts` (merchant logos), and `auth/routes.ts` (merchant logos) all still call `app.storage.publicUrl()` directly for thumbnails/logos. They only render because the bucket is public, not because of presigning. A real fix requires either migrating all of these call sites to `presignGet()` too, or making a deliberate, documented decision that these specific non-sensitive admin-curated prefixes (models/, catalog thumbnails) are meant to stay public and scoping the bucket policy to just those prefixes instead of the whole bucket.

---

#### SEC-H4 · Presigned PUT does not constrain object size
**Severity:** High
**Status:** 🔴 Open
**File:** `packages/storage/src/r2.ts:52`

`presignPut` ignores the `contentLength` argument — the signed URL places no `content-length-range` constraint. The Zod schema validates `contentLength ≤ 10 MB` at the API boundary, but a client can call `/v1/uploads/presign` and then PUT an arbitrarily large file directly to storage. The post-hoc `headObject` size check only runs when a job is submitted — an orphaned upload (no job created) is never checked.

**Fix options:**
- Switch from presigned PUT to **presigned POST** with an S3 `content-length-range` policy — the bucket enforces the limit server-side.
- **Or** add an ingress proxy (e.g. Cloudflare Worker or Nginx) that aborts the PUT stream when the body exceeds the limit.
- Separately, add a sweeper/lifecycle rule that deletes `inputs/*` objects older than 24h with no associated job row.

---

#### SEC-H5 · DNS-rebinding TOCTOU in the personal-background URL-fetch SSRF guard
**Severity:** High
**Status:** 🔴 Open (accepted risk, tracked here per final-review recommendation)
**File:** `apps/api/src/lib/ssrf-guard.ts`, `apps/api/src/lib/fetch-image.ts:20`

`assertPublicHttpUrl()` resolves the hostname via `dns.lookup()` and validates the resolved IP against private/loopback/link-local/CGNAT-adjacent ranges (including IPv4-mapped-IPv6 and decimal/hex-encoded bypass forms — those are closed). `fetchImageWithCap()` then calls `fetch(url)`, which performs its **own independent DNS resolution**. An attacker-controlled hostname with a 0-TTL DNS record can resolve to a public IP for the guard's lookup and to `127.0.0.1` (or an internal address) for the fetch's actual connection — a classic DNS-rebinding bypass. Requires attacker-controlled DNS infrastructure, so it is not exploitable by an arbitrary URL alone, and is not Critical, but it is a real gap against the original spec requirement ("validate the IP actually connected to, not just the pre-DNS hostname").

**Fix options:**
- Connect to the already-validated IP directly (pin it via a custom undici `Agent`/`lookup` override) and carry the original hostname in the `Host` header (and TLS `servername`), so the IP that was checked is the IP that's connected to.
- Simpler stopgap: re-resolve and re-check immediately before connecting in `fetchImageWithCap` isn't sufficient by itself (still a TOCTOU window, just smaller) — the pinned-IP approach is the real fix.

---

### 🔵 Blocked — Product / Ops Decisions (Pipeline Hardening)

#### PIPE-8 · Priority scheduler is starvation-prone
**Severity:** High (scheduling)
**Status:** 🔵 Blocked — product decision required
**File:** `apps/dispatcher/src/stream/consumer.ts`

The dispatcher reads streams in strict fixed order (`jobs:priority` → `jobs:normal` → `jobs:low`). Under sustained higher-tier load, normal/low jobs can be delayed indefinitely — all 3 GPU slots can be permanently occupied by priority work with no relief mechanism.

**Decision needed — choose an anti-starvation strategy:**
1. **Reserved capacity** — dedicate ≥1 GPU permanently to non-priority work (simplest to implement, clear guarantee).
2. **Weighted round-robin** — serve in a fixed ratio (e.g. 3 priority : 2 normal : 1 low).
3. **Aging** — promote a job's effective priority after it has waited beyond a threshold.

Depends on PIPE-9 resolution: if the priority cohort naturally shrinks (credits expiry), starvation pressure may be acceptable without structural changes.

---

#### PIPE-9 · Priority/tier is permanent after a single purchase
**Severity:** High (business)
**Status:** 🔵 Blocked — product decision required
**File:** `apps/api/src/modules/payments/routes.ts`

`users.tier` is set on successful payment and never downgraded. Plans are one-time credit top-ups, not subscriptions — a user who buys a priority plan once keeps priority forever, even after their credits hit zero. The priority cohort only ever grows, directly worsening PIPE-8 over time.

**Decision needed — what should grant priority access?**
1. Only while `userCredits.balance > 0`?
2. For N days after the most recent priority purchase?
3. Only while on an active recurring plan?

Once decided, the fix is in `create.ts`: compute effective tier from live balance/validity at enqueue time rather than reading the sticky `users.tier`.

---

#### PIPE-4 · SSE Redis connection fan-out under load
**Severity:** Medium (scale)
**Status:** 🔵 Blocked — needs prod Redis `maxclients` + expected peak concurrent tabs
**File:** `apps/api/src/modules/jobs/sse.ts:28`

Each SSE connection opens its own Redis subscriber via `.duplicate()`. During a 90-min backlog drain, ~100 user tabs → 100+ extra Redis client connections. Risk of hitting `maxclients` or OS fd limits at peak load.

**Fix:** Share a single Redis subscriber across all SSE connections with an in-process pub/sub fan-out keyed by `userId`. The 15s heartbeat and reconnect logic stay as-is.

**Blocked on:** what is the prod Redis `maxclients` setting and the expected peak concurrent open browser tabs? If the ceiling is comfortably above expected load, this can be deferred.

---

#### PIPE-5 · Input retention must exceed max queue wait
**Severity:** Medium (infra)
**Status:** 🔵 Blocked — ops must confirm R2/MinIO lifecycle ≥ 24h
**File:** `apps/dispatcher/src/job/processor.ts` (garment download at dispatch time)

A delayed job downloads its garment from R2/MinIO up to ~90 min after upload. If a lifecycle rule deletes user uploads before that, the job fails at download time with no refund path at the storage layer.

**Ops action needed:** confirm that the R2/MinIO lifecycle rule for the `inputs/` key prefix retains objects for ≥ 24 hours. Document the confirmed value. No code change if the lifecycle is already safe.

---

### 🔴 Deferred — Pipeline Scheduling

#### PIPE-6 · No per-user fairness within a tier
**Severity:** Low
**Status:** 🔴 Deferred — address only if power-user abuse observed
**File:** `apps/dispatcher/src/stream/consumer.ts`

Within a single tier the queue is strict FIFO. A user submitting 50+ jobs starves other users in the same tier during a backlog. An interleave-by-`userId` scheduler would fix this but adds complexity. Overlaps with PIPE-8.

---

#### PIPE-7 · No ComfyUI batching
**Severity:** Low (future throughput)
**Status:** 🔴 Deferred — out of scope for initial hardening

Currently 1 ComfyUI prompt per job (4 poses = 4 separate dispatches). Batching a user's poses into a single workflow run could cut per-job overhead, but requires workflow-template changes and partial-failure handling. Noted as a future optimization.

---

#### PIPE-S5 · Free-trial credits farmable via disposable emails
**Severity:** Low (mitigated)
**Status:** 🟡 Mitigated — defer unless abuse observed
**Files:** `apps/api/src/modules/auth/routes.ts`, `apps/api/src/modules/auth/google.routes.ts`

Free-trial credits are granted at account creation. Spending requires a verified email, which raises the bar, but disposable/temp-mail services still receive verification links. Determined Sybil farming remains possible.

**If abuse is observed:** add per-IP/per-device signup limits, block known disposable-email domains, or require a payment method before granting trial credits.

---

## Summary Table

| ID | Area | Severity | Complexity |
|----|------|----------|------------|
| P2-9 | Mobile: orphaned R2 upload | Medium | Medium |
| P3-2 | Mobile: no CI version bump | Low | Low |
| 7.5/9.1 | Dispatcher/ComfyUI sandboxing | Critical | High |
| 7.1 | Widget origin / API key abuse | High | High |
| 2.3 | Merchant analytics | Medium | High |
| 2.4 | Idempotency key on job create | Medium | Medium |
| 4.3 | Hardcoded responsive breakpoints | Medium | High |
| 8.2 | Migration index conflict CI check | Medium | High |
| 9.4 | DB seeding standardization — partial, catalog only | Medium | Medium |
| 1.4 | BFF non-auth proxying overhead | Medium | High |
| 11.3 | Admin fragmented styling | Medium | High |
| SEC-C1 | Security: leaked VPS credential — rotated 2026-08-12, history purge still open | High | Ops |
| SEC-H2 | Security: access_token in memory ✅; CSP still open 🔴 | High | Medium |
| SEC-H3 | Security: world-readable storage bucket — prod's live bucket still is, grandfathered | High | Migrate remaining `publicUrl()` call sites or scope bucket policy to specific prefixes |
| SEC-H4 | Security: presigned PUT unbounded size | High | Medium |
| SEC-H5 | Security: DNS-rebinding TOCTOU in background URL-fetch SSRF guard | High | Medium |
| PIPE-8 | Pipeline: priority starvation | High | Product decision |
| PIPE-9 | Pipeline: tier permanent after one purchase | High | Product decision |
| PIPE-4 | Pipeline: SSE Redis fan-out | Medium | Ops input |
| PIPE-5 | Pipeline: input retention lifecycle | Medium | Ops action |
| PIPE-6 | Pipeline: no per-user fairness | Low | Deferred |
| PIPE-7 | Pipeline: no ComfyUI batching | Low | Deferred |
| PIPE-S5 | Pipeline: free-trial credit farming | Low | Mitigated |

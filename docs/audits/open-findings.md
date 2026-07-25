# Open Findings — Consolidated Backlog

**Last updated:** 2026-06-30  
**Status:** All P0 blockers and P1 high-risk issues resolved. This document is the single consolidated backlog — it now includes all remaining open items from `docs/security-production-audit.md` (SEC-*) and `docs/production-backlog-hardening.md` (PIPE-*) in addition to the original mobile and platform findings.

---

## Part 1 — Admin Mobile (apps/admin-mobile)

> All 6 P0 blockers and all 10 P1 high-risk findings have been resolved. Remaining items are P2 quality and P3 polish.

### 🟡 P2 — Medium / Quality

#### P2-1 · `KeyboardAvoidingView behavior="padding"` breaks login form on Android
**File:** `src/app/(auth)/login.tsx` (line 41)

`behavior="padding"` only works reliably on iOS. On Android the keyboard pushes the view up or overlaps the form depending on `windowSoftInputMode`.

**Fix:** `Platform.OS === 'ios' ? 'padding' : 'height'`

---

#### P2-2 · EAS `production` profile builds an APK, not an AAB — Play Store incompatible
**File:** `apps/admin-mobile/eas.json` (lines 21–24)

Google Play requires Android App Bundles (AAB). The current `buildType: "apk"` can only be sideloaded.

**Fix:**
```json
"production": {
  "android": {
    "buildType": "app-bundle",
    "gradleCommand": ":app:bundleRelease"
  }
}
```

---

#### P2-3 · `workers.tsx` "Active jobs" metric hardcoded to `'1'` or `'0'`
**File:** `src/app/(tabs)/more/workers.tsx` (line 140)

```tsx
<Metric label="Active jobs" value={worker.status === 'BUSY' ? '1' : '0'} />
```

Assumes a busy worker always has exactly 1 job. Either get real data from the API or rename to "Status".

---

#### P2-4 · `settings.tsx` — `useEffect` with empty deps calls `localSettings.load()` with stale closure
**File:** `src/app/(tabs)/more/settings.tsx` (lines 44–46)

`localSettings` missing from deps array. Breaks exhaustive-deps rule. Benign in practice (Zustand actions are stable) but inconsistent with the rest of the codebase.

---

#### P2-5 · `home.tsx` magic number `paddingBottom: bottom + 100` for floating tab bar
**File:** `src/app/(tabs)/home.tsx` (line 97)

Hardcoded `100` assumes a fixed tab bar height. Will break on foldables, tablets, or if tab bar dimensions change. Export the tab bar height as a constant.

---

#### P2-6 · `WorkerDetailCard` in `home.tsx` duplicates the `WorkerCard` component
**File:** `src/app/(tabs)/home.tsx` (lines 351–378)

An inline `WorkerDetailCard` renders essentially the same layout as `src/components/WorkerCard.tsx`. Two divergent implementations to maintain. Unify into `WorkerCard`.

---

#### P2-7 · `statusColor` / `statusLabel` in `home.tsx` re-implement `StatusBadge` logic
**File:** `src/app/(tabs)/home.tsx` (lines 20–50)

Worker status color/label mapping is re-implemented inline rather than using the shared `StatusBadge.tsx` utility.

---

#### P2-8 · No accessibility roles on interactive elements across all asset screens
**Files:** `assets/backgrounds/index.tsx`, `assets/faces/index.tsx`, `assets/garment-types/index.tsx`, `assets/poses/index.tsx`, `assets/pose-assets/index.tsx`

Asset cards, category cards, and bulk-action bars have no `accessibilityRole`, `accessibilityLabel`, or `accessibilityHint` on `TouchableOpacity` elements. Affects Play Store accessibility policy compliance.

---

#### P2-9 · `uploadTwoImage` orphans main image when thumbnail upload fails
**File:** `src/lib/upload.ts` (lines 39–60)

If the main image uploads to R2 successfully but thumbnail generation or upload fails, the function throws without calling `confirmEndpoint`. The main image is permanently orphaned in R2.

**Fix:** Catch thumbnail failure and call a delete endpoint, or rely on a 24-hour R2 lifecycle rule for unconfirmed uploads.

---

#### P2-10 · `jobs/index.tsx` `loadInitial` stops spinner on stale request completion
**File:** `src/app/(tabs)/jobs/index.tsx` (lines 76–85)

If `fetchPage(1)` resolves after a `requestId` mismatch, `loadInitial`'s `finally` block still calls `setLoading(false)`, hiding the spinner while the actual active request is still pending.

**Fix:** Check `requestId` inside `loadInitial` before setting loading state, or rely entirely on `refreshing`/`paginating` states managed inside `fetchPage`.

---

#### P2-11 · `jobs/index.tsx` SSE stream doesn't surface newly created jobs
**File:** `src/app/(tabs)/jobs/index.tsx` (lines 94–117)

The SSE handler calls `current.map(job => ...)`. If a brand-new job arrives via SSE, it's not in `current` — the `map` ignores it. The user sees new jobs only after a manual pull-to-refresh.

**Fix:** If `update.jobId` is not found in the array (and matches current filters), fetch the job details or prepend a placeholder to the top of the list.

---

### 🔵 P3 — Low / Polish

#### P3-1 · UUID regex in `home.tsx` SmartSearch accepts malformed IDs
**File:** `src/app/(tabs)/home.tsx` (line 82)

```ts
const id = query.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
```

The character class `[0-9a-f-]` includes a literal `-`, matching non-UUID strings. Use a proper UUIDv4 pattern.

---

#### P3-2 · No automated version/build number bump in CI
**File:** `apps/admin-mobile/app.config.js` (line 9)

Manual version bumping in a fast-moving repo is error-prone. Play Store and TestFlight reject duplicate build numbers.

**Fix:** Use `appVersionSource: "remote"` (EAS) or a pre-build hook reading from `git describe`.

---

#### P3-3 · `widget-clients/[id].tsx` skeleton loader doesn't fill screen height
**File:** `src/app/(tabs)/more/widget-clients/[id].tsx` (lines 140–145)

Loading wrapper `View` lacks `flex: 1`. Skeletons render in a compact block at the top rather than filling the screen. Inconsistent with all other detail screens.

---

#### P3-4 · Home screen 30s poll activates pull-to-refresh spinner visually
**File:** `src/app/(tabs)/home.tsx` (lines 72–76)

`refreshControl` with `refreshing={loading}` activates every 30 seconds during background polls. On a mounted monitor the spinner pulses constantly. Use the existing "Last refreshed: HH:MM:SS" badge for background polls; reserve the spinner for user-triggered refreshes.

---

#### P3-5 · `users/index.tsx` debounce timer may fire after unmount
**File:** `src/app/(tabs)/more/users/index.tsx` (lines 30–33)

`clearTimeout` in cleanup correctly handles the common case, but if the component unmounts after the timer fires but before `apiFetch` resolves, `setDebouncedSearch` still runs on an unmounted component. Low risk; consider a mounted-ref guard.

---

#### P3-6 · App version `1.0.1` with no changelog in the repo
**File:** `app.config.js`

No `CHANGELOG.md` exists for the mobile app. Internal EAS testers have no reference for what changed between builds.

---

#### P3-7 · Unmounted state update in `more/users/[id].tsx` on user delete
**File:** `src/app/(tabs)/more/users/[id].tsx` (lines 129–144)

`router.back()` is called synchronously after delete success. The `finally` block then calls `setActioning(false)` on the now-unmounted component, triggering a React memory leak warning.

---

#### P3-8 · Unmounted state update in `login.tsx` on successful login
**File:** `src/app/(auth)/login.tsx` (lines 24–39)

After `await login(...)` succeeds, `AuthGate` redirects the user and `LoginScreen` unmounts. The `finally` block still calls `setLoading(false)` on the unmounted component.

---

#### P3-9 · `useAdminJobStream` recreates `options` object on every render
**File:** `src/hooks/useAdminJobStream.ts` (lines 9–13)

Default parameter `options = {}` creates a new object on every render when the caller omits `options`. While `useSSE` handles this safely via refs, it's an anti-pattern that could trigger unnecessary effect re-runs if `useSSE`'s dependency tracking changes.

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

Public widget API keys are static strings. Outside a browser, `Origin` headers are trivially spoofed via `curl`. A merchant's public key can be used to drain their credits from any script.

**Options (requires product decision):**
1. **reCAPTCHA v3 / Cloudflare Turnstile** — browser-only challenge; add token verification before credit deduction
2. **Server-signed session tokens** — merchant's backend calls a signing endpoint with the secret key; widget receives a short-lived JWT; API validates JWT instead of raw public key

Both options require coordinated changes to the widget embed, the merchant's integration docs, and the API. High implementation complexity — needs a design session before implementation.

---

#### 11.1 · Primitive Div-Based Charts in Admin Dashboard
**Severity:** High  
**File:** `apps/admin-web/src/pages/DashboardPage.tsx`

All charts (job volume, revenue, success rate) are hand-drawn with `div` elements and inline `width` percentages. No axis labels, no tooltips, no responsive sizing, no accessibility. The `recharts` package is already installed (`package.json`).

**Fix:** Replace div bars with `<BarChart>` / `<LineChart>` from `recharts`. The data shape is already correct — this is a pure UI swap.

---

### 🟠 Medium

#### 2.3 · Merchant Analytics Dashboard
**Severity:** Medium  
**Complexity:** High

No per-merchant analytics surface exists. Merchants can't see their job volume, success rate, credit burn rate, or output gallery without contacting support. Requires a new API aggregate endpoint and a web UI page. Defer to a dedicated sprint.

---

#### 2.4 · Idempotency Key on `POST /v1/widget/jobs`
**Severity:** Medium  
**Complexity:** Medium  
**File:** `apps/api/src/modules/widget/widget.routes.ts`

No idempotency protection on job creation. A double-submit (network retry, accidental re-click) creates two jobs and deducts credits twice. Fix: accept an optional `Idempotency-Key` header; cache the response keyed on `(clientId, idempotency-key)` in Redis for 24h; return the cached response on duplicate.

---

#### 4.3 · Hardcoded Responsive Breakpoints
**Severity:** Medium  
**Complexity:** High  
**Files:** `apps/catalogues-web/src/app/globals.css`, multiple component files

Responsive layout breakpoints are scattered as magic pixel values (`768px`, `1024px`, `1280px`) across CSS media queries and inline style conditionals. No shared breakpoint tokens. Changing the layout grid requires hunting every file.

**Fix:** Define `--bp-sm`, `--bp-md`, `--bp-lg` CSS custom properties in `:root` and reference them via `@media (min-width: var(--bp-md))` or a shared `breakpoints.ts` constant file.

---

#### 8.2 · DB Migration Index Conflict Risk
**Severity:** Medium  
**Complexity:** High  
**Files:** `packages/db/src/migrations/`

When two branches independently add migrations, they collide on the same `NNNN_` index. The resolution process (rename, re-journal, manual apply-one) is manual and error-prone. Documented in `CLAUDE.md` but not automated.

**Fix:** A pre-push CI check that verifies the highest local migration index is greater than the highest index on `origin/master`. Fail fast with a rename instruction rather than discovering the collision post-merge.

---

#### 9.4 · DB Seeding Standardization
**Severity:** Medium  
**Complexity:** Medium  
**File:** `packages/db/src/seed.ts` (exists), `scripts/seed-catalog.ts`

`seed.ts` was added but is incomplete. `seed-catalog.ts` is a standalone script outside the package. There is no unified `pnpm seed` command that handles dev environment setup end-to-end (admin user, catalog types, sample workflow templates). New developers must manually piece together the seed sequence.

**Fix:** Consolidate seed logic into `packages/db/src/seed.ts`; expose as `pnpm db:seed` via the root `package.json`; document the full dev-setup sequence in `CLAUDE.md`.

---

#### 1.4 · BFF Proxying Overhead for Non-Auth Routes
**Severity:** Medium  
**Complexity:** High  
**Files:** `apps/catalogues-web/src/app/api/`

Some non-auth API calls route through the Next.js BFF (adding an extra network hop) when they could call the Fastify API directly. Architectural — requires auditing each BFF route to categorise: auth-only (keep BFF), data fetch (call API directly from client), sensitive (keep BFF). Defer to a dedicated refactor sprint.

---

### 🟢 Low

#### 8.3 · Hardcoded Port Conflicts in Dev
**Severity:** Low  
**Complexity:** Low  
**Files:** `apps/api/src/server.ts`, `apps/dispatcher/src/index.ts`

Default ports (4000, 4001) are hardcoded in source. If another service uses those ports, startup silently fails or the developer gets a cryptic EADDRINUSE. Read from `PORT` env var with the hardcoded value as fallback.

---

#### 8.4 · Missing Shared Config Management
**Severity:** Low  
**Complexity:** Medium

Each app reads `process.env.*` directly with no central validation. A missing required env var only surfaces at the point of first use (often deep in a request handler) rather than at startup. Add a startup validation step (e.g., Zod parse of `process.env`) in each app's entry point.

---

#### 11.3 · Fragmented Admin Styling
**Severity:** Medium  
**Complexity:** High  
**File:** `apps/admin-web/src/`

The admin SPA has no shared component library — buttons, cards, badges, and modals are re-styled inline across pages. Design drift is visible (inconsistent padding, border-radius, font sizes between pages). Requires an incremental extraction of shared components — no big-bang rewrite, but each new page/feature should pull from a growing `components/` library.

---

#### 11.5 · Brittle Theme State Sync
**Severity:** Low  
**Complexity:** Low  
**File:** `apps/admin-web/src/`

Theme preference (dark/light) is stored in a local React state that resets on page reload or when navigating between admin pages. Should persist to `localStorage` and read on mount.

---

---

## Part 3 — Security Audit & Pipeline Hardening (Open Items)

> Source: `docs/security-production-audit.md` and `docs/production-backlog-hardening.md`.
> All code-fixable items in both documents have been resolved. What remains are items that require an ops action, a product decision, or a non-trivial architectural change.

---

### 🔴 Critical / High — Security

#### SEC-C1 · Leaked VPS credential still in git history
**Severity:** Critical (ops action)
**Status:** 🟡 Partial — placeholder committed to `.env.production.example`, history not yet purged
**File:** `.env.production.example` (commit `619622e`)

The real ComfyUI Basic-Auth password (`WIDGET_COMFYUI_BASIC_AUTH=REDACTED_ROTATED_2026-08-12`) for VPS `38.247.186.118:8339` was committed and remains in git history even after the file was updated with a placeholder.

**Required ops actions (in order):**
1. Rotate the ComfyUI Basic-Auth password on the VPS **now** (assume credential is burned).
2. Purge from history: `git filter-repo --replace-text <(echo 'Niceinteractive@2026==>CHANGE_ME') --force` then force-push all remotes.
3. Add a pre-commit secret scanner (gitleaks / trufflehog) to CI so this class of leak is caught automatically.

---

#### SEC-C2 · SSRF via `garmentImageUrl` in widget job creation
**Severity:** Critical
**Status:** ✅ Fixed (2026-06-30)
**File:** `apps/api/src/modules/widget/routes.ts:141`

`assertSafeExternalUrl()` added before any fetch: enforces `https`-only scheme, resolves the hostname via `dns.lookup`, and blocks RFC1918, loopback (`127.x`, `::1`), and link-local (`169.254.x`) ranges. Throws `BAD_REQUEST` before any credit check or network I/O if the URL is internal.

---

#### SEC-H1 · Open, unthrottled merchant signup — active-by-default
**Severity:** High
**Status:** ✅ Fixed (2026-06-30)
**File:** `apps/api/src/modules/merchant/routes.ts:16`, `packages/db/src/schema/widget.ts:29`

Three changes applied together:
1. `widget_clients.is_active` schema default changed to `false` (migration `0076_widget_clients_inactive_default.sql`). New accounts cannot use the API until an admin activates them.
2. Signup route rate-limited to 5 requests / 1 hour.
3. `widgetKey` withheld from the signup response — response now returns only `id`, `email`, `companyName`, and a "pending approval" message.

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
**Status:** ✅ Fixed (2026-06-30)
**File:** `infra/docker-compose*.yml` (`mc anonymous set download`)

`mc anonymous set download` removed from both `docker-compose.yml` and `docker-compose.prod.yml`. Bucket is now private. All private content in `/admin/results/data` is now served via presigned GET URLs (1 h TTL) via a `presign()` helper — `garmentUrl`, `poseUrl`, `backgroundUrl`, `lowerUrl`, `shoeUrl`, `outputUrl` all use `app.storage.presignGet(key, 3600)` instead of `publicUrl()`.

**Note:** Curated catalog thumbnails and pose thumbnails (public reads) still work because they are served via presigned URLs on demand — no separate public prefix needed for the current traffic pattern.

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
| P2-1 | Mobile: Android keyboard form | Medium | Low |
| P2-2 | Mobile: EAS production APK→AAB | Medium | Low |
| P2-3 | Mobile: Workers hardcoded metric | Medium | Low |
| P2-4 | Mobile: settings.tsx stale closure | Low | Low |
| P2-5 | Mobile: tab bar magic number | Low | Low |
| P2-6 | Mobile: WorkerDetailCard duplicate | Low | Low |
| P2-7 | Mobile: statusColor re-implemented | Low | Low |
| P2-8 | Mobile: accessibility roles missing | Medium | Medium |
| P2-9 | Mobile: orphaned R2 upload | Medium | Medium |
| P2-10 | Mobile: stale spinner on loadInitial | Low | Low |
| P2-11 | Mobile: SSE misses new jobs | Medium | Medium |
| P3-1 | Mobile: UUID regex loose | Low | Low |
| P3-2 | Mobile: no CI version bump | Low | Low |
| P3-3 | Mobile: skeleton height | Low | Low |
| P3-4 | Mobile: poll spinner distraction | Low | Low |
| P3-5 | Mobile: debounce post-unmount | Low | Low |
| P3-6 | Mobile: no changelog | Low | Low |
| P3-7 | Mobile: unmounted state (delete) | Low | Low |
| P3-8 | Mobile: unmounted state (login) | Low | Low |
| P3-9 | Mobile: options object recreated | Low | Low |
| 7.5/9.1 | Dispatcher/ComfyUI sandboxing | Critical | High |
| 7.1 | Widget origin / API key abuse | High | High |
| 11.1 | Admin div-based charts → recharts | High | Medium |
| 2.3 | Merchant analytics | Medium | High |
| 2.4 | Idempotency key on job create | Medium | Medium |
| 4.3 | Hardcoded responsive breakpoints | Medium | High |
| 8.2 | Migration index conflict CI check | Medium | High |
| 9.4 | DB seeding standardization | Medium | Medium |
| 1.4 | BFF non-auth proxying overhead | Medium | High |
| 8.3 | Hardcoded port fallbacks | Low | Low |
| 8.4 | Env var startup validation | Low | Medium |
| 11.3 | Admin fragmented styling | Medium | High |
| 11.5 | Admin theme not persisted | Low | Low |
| SEC-C1 | Security: leaked VPS credential in git history | Critical | Ops |
| SEC-C2 | ~~Security: SSRF via garmentImageUrl~~ ✅ Fixed | Critical | — |
| SEC-H1 | ~~Security: open merchant signup~~ ✅ Fixed | High | — |
| SEC-H2 | Security: access_token in memory ✅; CSP still open 🔴 | High | Medium |
| SEC-H3 | ~~Security: world-readable storage bucket~~ ✅ Fixed | High | — |
| SEC-H4 | Security: presigned PUT unbounded size | High | Medium |
| SEC-H5 | Security: DNS-rebinding TOCTOU in background URL-fetch SSRF guard | High | Medium |
| PIPE-8 | Pipeline: priority starvation | High | Product decision |
| PIPE-9 | Pipeline: tier permanent after one purchase | High | Product decision |
| PIPE-4 | Pipeline: SSE Redis fan-out | Medium | Ops input |
| PIPE-5 | Pipeline: input retention lifecycle | Medium | Ops action |
| PIPE-6 | Pipeline: no per-user fairness | Low | Deferred |
| PIPE-7 | Pipeline: no ComfyUI batching | Low | Deferred |
| PIPE-S5 | Pipeline: free-trial credit farming | Low | Mitigated |

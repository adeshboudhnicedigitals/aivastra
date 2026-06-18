# REMEDIATION_LOG.md

Running log of security fixes applied against findings in `VULNERABILITY_REPORT.md` / `THREAT_MODEL.md`.
Each entry is appended as a fix lands. Newest at top.

## Status Tracker

| ID | Severity | Finding | Status |
| -- | -------- | ------- | ------ |
| H1 | HIGH   | Arbitrary R2 object read via thumbnail presign (IDOR) | ✅ Fixed |
| H2 | HIGH   | Unvalidated user-supplied R2 keys as job inputs (IDOR) | ✅ Fixed |
| M1 | MEDIUM | Access token accepted in query string | ✅ Fixed |
| M2 | MEDIUM | Presigned PUT does not bind object size | ✅ Fixed |
| M3 | MEDIUM | User images exposed via public bucket path | ⬜ Open (infra) |
| M4 | MEDIUM | Refresh-token reuse does not revoke the family | ✅ Fixed |
| M5 | MEDIUM | Secret length floor too low | ✅ Fixed |
| M6 | MEDIUM | Admin/results login lacks dedicated rate limit | ✅ Fixed |
| M7 | MEDIUM | JWT verification does not pin the algorithm | ✅ Fixed |
| M8 | MEDIUM | Attacker-controlled file extension into ComfyUI filename | ✅ Fixed |
| L1 | LOW    | Non-constant-time signature comparison (verify-payment route) | ✅ Fixed |
| L2 | LOW    | Plaintext secrets in working tree | ⬜ Open (ops) |
| L3 | LOW    | API listens on `0.0.0.0` | ⬜ Open (ops, expected) |

---

## Deferred — infra / ops (no clean code fix)

These three are not application-code defects; they need infra/ops action and are
left open intentionally. Listed here so they aren't lost.

### M3 — User images exposed via public bucket path  *(UNCERTAIN)*
`results/routes.ts` builds image URLs with unsigned `publicUrl()` over the prod
`R2_PUBLIC_URL` path. If that path is world-readable, only the UUID-in-key
obscures user content. **Action:** make the bucket/proxy path private and serve
all user images via presigned GET (the user-facing job/result endpoints already
do). Code change is localized (swap `publicUrl` → `presignGet` in the results
data route + admin monitor HTML), but it's a behavior change gated on the
bucket/proxy ACL — confirm the live ACL first, then flip together. Not done here
to avoid breaking the results panel without the infra side.

### L2 — Plaintext secrets in working tree
`.env`, `.env.production`, `client_secret_*.json` sit in plaintext on disk
(verified gitignored + absent from git history). **Action (ops):** move to a
secret manager / out-of-tree path; rotate the Google client secret if the dev
machine or any backup was ever shared. No code change.

### L3 — API listens on `0.0.0.0`
`apps/api/src/main.ts:9` binds `0.0.0.0` — expected behind the reverse
proxy / Cloudflare tunnel (containers need it). **Action (ops):** confirm the
host firewall does not expose `:4000` directly (Postgres/Redis already bind
`127.0.0.1`). No code change; could add an `API_HOST` env override later if a
deployment needs loopback-only binding.

---

## L1 — Non-constant-time signature comparison

- **Date:** 2026-06-18
- **Severity:** LOW
- **Status:** ✅ Fixed
- **File:** `apps/api/src/modules/payments/routes.ts`

### Problem
The Razorpay verify-payment route compared the expected HMAC with `expected !==
razorpaySignature` (non-constant-time → theoretical timing oracle). The webhook
route already used `timingSafeEqual`; the client-facing verify route did not.

### Fix
Length-guarded `crypto.timingSafeEqual(Buffer.from(expected),
Buffer.from(razorpaySignature))` (same pattern as the webhook handler).

### Verification
`tsc --noEmit` clean; api unit 40/40.

---

## M6 — Admin/results login lacks dedicated rate limit

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **File:** `apps/api/src/modules/results/routes.ts`

### Problem
`POST /results/login` ran only under the global 200/min limiter, unlike
`/v1/auth/login` (5/min). argon2 slows brute force but there's no lockout —
admin/results account compromise = full data-panel access.

### Fix
Added `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` to the route,
matching `/v1/auth/login`.

### Verification
`tsc --noEmit` clean; api unit 40/40.

---

## M5 — Secret length floor too low

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **Files:** `apps/api/src/env.ts`, `.env`, `.env.example`,
  `apps/api/test/helpers/api.ts`, `apps/api/test/integration/google-oauth.test.ts`

### Problem
`JWT_SECRET` / `COOKIE_SECRET` floor was `min(16)` — 128-bit at best, far less
for a passphrase. HS256 keys should be ≥256-bit.

### Fix
Raised both to `z.string().min(32)`. Bumped dev/test/example secrets that were
below the new floor (`.env`, `.env.example`, the two test-app env builders) so
boot/tests still pass; added `openssl rand -base64 48` guidance to `.env.example`.
Production secrets were already 64/128 chars — unaffected.

### Verification
`tsc --noEmit` clean; api unit 40/40 (test env secrets now ≥32).

---

## M7 — JWT verification does not pin the algorithm

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **File:** `apps/api/src/modules/auth/service.ts`

### Problem
`jwtVerify(token, secret)` did not pin `algorithms`. Low practical risk (jose
rejects `none`, symmetric key only permits HMAC) but pinning is free defense.

### Fix
`verifyAccess` / `verifyAdminAccess` now pass `{ algorithms: ['HS256'] }`.

### Verification
`tsc --noEmit` clean; api unit 40/40.

---

## M4 — Refresh-token reuse does not revoke the family

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **File:** `apps/api/src/modules/auth/routes.ts`

### Problem
A reused (already-rotated, past-grace) refresh token was denied but the token
**family was not revoked**. Reuse signals theft; standard rotation revokes the
whole family so a stolen token can't keep the session alive.

### Fix
In the stale-token branch with **no active successor** (the theft signal — the
legitimate chain would have left a live successor), revoke the entire family
(`UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1`) before
returning invalid → forces re-login. The successor branch (benign concurrent
refresh within the grace window) is intentionally left untouched, so normal
races don't trigger false revocations.

### Verification
`tsc --noEmit` clean; api unit 40/40. (Family-revoke behaviour exercised by
integration tests, which need docker — not in the pre-push unit set.)

---

## M2 — Presigned PUT does not bind object size

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **Files:** `packages/storage/src/index.ts`, `packages/storage/src/r2.ts`,
  `apps/api/src/modules/jobs/create.ts`

### Problem
The presigned PUT omits `ContentLength` (including it breaks the signature when
the real size differs), so the `≤10MB` zod cap was cosmetic — the signed URL
accepted any size (storage/egress DoS).

### Fix
A presigned PUT can't carry a size range (that's a presigned-POST policy
feature). Instead, enforce size **after** upload, at job creation: added
`headObject(key)` to `StorageProvider` (+ R2 impl via `HeadObjectCommand`), and
`assertOwnsUploadKey` now HEADs each garment key and rejects
`contentLength > 10MB` (`413`). Doubles as an existence check (missing object →
`400`). Runs in the same pre-write validation as the H2 ownership check.

### Verification
storage build + `tsc --noEmit` clean across storage/api/dispatcher; api unit
40/40, dispatcher 33/33.

### Residual risk
Bandwidth to upload an oversized object is still spent before the HEAD rejects
it; the cap prevents it being *used*/retained for a job. A true upload-time
cap needs a presigned-POST migration (browser upload change) — deferred.

---

## M8 — Attacker-controlled file extension into ComfyUI filename

- **Date:** 2026-06-18
- **Severity:** MEDIUM (UNCERTAIN sink impact)
- **Status:** ✅ Fixed
- **Files:** `packages/types/src/jobs.ts` (via H2),
  `apps/dispatcher/src/job/processor.ts`

### Problem
`uploadToComfy` derived the upload filename extension from the raw key
(`key.split('.').pop()`), which for user keys was attacker-controlled — could
inject path separators/traversal into the ComfyUI `/upload/image` filename.

### Fix — both sides
1. **Input** (via H2): `upperGarmentKey`/`lowerGarmentKey` are now regex-pinned
   to `inputs/<uuid>/garment.jpg`, so no separators reach the dispatcher.
2. **Sink** (`processor.ts`): `ext` is now chosen from a strict allow-list
   (`png|webp|jpg`, default `jpg`) and the MIME is derived from that allow-list,
   not the key. The filename sent to ComfyUI is built only from our own
   `prefix + jobId + safe-ext` — no key content can reach it, for user-supplied
   AND server-derived keys alike.

### Verification
`tsc --noEmit` clean; dispatcher unit 33/33.

---

## M1 — Access token accepted in query string

- **Date:** 2026-06-18
- **Severity:** MEDIUM
- **Status:** ✅ Fixed
- **File:** `apps/api/src/plugins/auth.ts`

### Problem
`requireUser` / `requireAdminUser` accepted the access JWT via `?token=` query
param (`token = bearer ?? queryToken`). Tokens in URLs leak into reverse-proxy /
access logs, browser history, and `Referer`. The query path was intended for SSE
(native `EventSource` can't set headers).

### Fix
**Removed query-token acceptance from both preHandlers — header-only auth.**
Investigation showed the query path is **dead**: both SSE clients
(`apps/web/src/lib/sse.ts`, `apps/admin/src/lib/sse.ts`) are fetch-based readers
that send `Authorization: Bearer` headers, not native `EventSource`. No client
ever used `?token=`. So removal fully closes M1 with zero behavior change — no
SSE-ticket indirection needed.

(The unrelated `?token=` on `/v1/auth/verify-email` is a single-use email token
handled in that route, not the access JWT — untouched.)

### Verification
- `pnpm --filter @aivastra/api exec tsc --noEmit` — clean.
- Confirmed no `query.token` consumers remain except the email-verify route.
- web + admin SSE keep working (header auth, fetch-based stream reader).

### Residual risk
None. If a future client needs native `EventSource`, mint a short-lived
single-use SSE ticket (per report) rather than reintroducing the access JWT in
the URL.

---

## H2 — Unvalidated user-supplied R2 keys as job inputs (IDOR)

- **Date:** 2026-06-18
- **Severity:** HIGH
- **Status:** ✅ Fixed
- **Files:** `packages/types/src/jobs.ts`, `apps/api/src/modules/uploads/routes.ts`,
  `apps/api/src/modules/jobs/create.ts`

### Problem
`upperGarmentKey` / `lowerGarmentKey` were validated only as `string(1..512)`.
`createJob` stored them verbatim; the dispatcher then downloaded them and shipped
them to ComfyUI. A user could set the key to another user's input, any output, or
an internal asset key — cross-user image use + object-existence oracle. Also fed
the M8 filename-extension surface (`key.split('.').pop()`).

### Fix — two layers
1. **Format pin (boundary).** New `INPUT_GARMENT_KEY` regex in `types/jobs.ts`
   constrains both keys to the exact issued shape `inputs/<uuid>/garment.jpg`.
   Rejects arbitrary/traversal keys at validation — also closes the **M8** input
   side (no separators/`..` can reach the ComfyUI filename).
2. **Ownership binding (authZ — the real fix).** Format alone can't stop
   cross-user use (another user's key is the same shape). `/v1/uploads/presign`
   now records `upload:owner:<r2Key> -> userId` in Redis (24h TTL, covers slow
   wizard sessions). `createJob` calls `assertOwnsUploadKey()` for each garment
   key **before any credit/DB mutation**; a key bound to nobody (expired/never
   issued) or to another user → `403 FORBIDDEN`.

### Verification
- `pnpm --filter @aivastra/types exec tsc --noEmit` — clean.
- `pnpm --filter @aivastra/api exec tsc --noEmit` — clean.
- `pnpm --filter @aivastra/api test` (unit) — 40/40 pass.
- Frontend unaffected: studio always submits the `r2Key` returned by presign,
  which now also carries the ownership record.

### Residual risk / notes
- Redis flush between presign and submit drops the binding → legit job gets a
  clean 403 (user re-uploads). Acceptable security/UX trade-off; 24h TTL.
- Bound to user, not consumed — same user may resubmit their own key within TTL
  (not a vuln). No one-time-use needed.
- **Stale integration tests** (`jobs-create.test.ts`, `e2e.test.ts`) hardcode
  `inputs/x/garment.jpg` and pre-refactor field names (`modelCatalogId`, …);
  already broken before this change, excluded from the pre-push hook. Not
  rewritten here — out of scope. Flag for a separate test-refresh pass.

---

## H1 — Arbitrary R2 object read via thumbnail presign (IDOR)

- **Date:** 2026-06-18
- **Severity:** HIGH
- **Status:** ✅ Fixed
- **File:** `apps/api/src/modules/uploads/routes.ts`

### Problem
`GET /v1/uploads/thumbnail?key=` presigned a 1-hour GET for **any** bucket key
with no ownership/prefix check. Any email-verified user could read other users'
inputs/outputs and internal ComfyUI assets (`models/poses/<id>.faceside.jpg`,
`catalog/<slug>/<id>.jpg`, etc.) — keys partly enumerable from IDs the public
`/v1/models/*` and `/v1/catalog/*` APIs already expose.

### Fix
**Removed the endpoint entirely.** It had zero callers — web and admin already
fetch images through server-derived, ownership-scoped routes:
- `/v1/jobs/:id/thumbnail` (job ownership checked)
- `/v1/jobs/:id/result`
- `/v1/assets` (batch presign, server resolves keys)

Deleting the route eliminates the IDOR and the entire "client supplies the
storage key" bug class for this path, rather than patching it with an ownership
guard on a dead endpoint. Matches the report's preferred remediation
("stop accepting raw keys from clients entirely").

### Verification
- `pnpm --filter @aivastra/api exec tsc --noEmit` — clean.
- No callers in `apps/web`, `apps/admin`, or `apps/api/test`.
- Zero behavior change (endpoint was unused).

### Residual risk
None for this path. Note H2/M3 share the same root cause (client-named keys)
but on **live** code paths — they require ownership-binding, not deletion.

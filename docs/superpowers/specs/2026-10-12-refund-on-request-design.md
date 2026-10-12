# Refund on customer request — design

**Date:** 2026-10-12
**Status:** implemented on branch feat/refund-on-request

## Goal

After a generation completes in `apps/catalogues-web`, the customer can ask for the credits back
for an image they are unhappy with. The request lands in the admin panel; **credits are refunded
only after an admin approves.** Nothing is refunded automatically.

## Decisions

| Question | Decision |
|---|---|
| Granularity | One request per image (job). The button sits on each result tile beside Regenerate. |
| Eligibility | Job is the caller's, `COMPLETED`, never downloaded (a Google Drive export counts as a download), `creditsCharged > 0`, not a merchant / API-key / Shopify job, the ledger shows credits still debited for it (`SUM(credit_ledger.delta) < 0` for that job and user), and it has no earlier request. A rejected request cannot be re-filed. Unlimited-plan jobs are excluded: `atomicDeduct` charges them 0 (a delta-0 `UNLIMITED_PLAN_USAGE` row) even though `jobs.creditsCharged` still holds the plan cost. |
| Request form | Fixed reason list plus an optional note (300 chars max). |
| Regenerate | Blocked while the request is `PENDING` or `APPROVED`; allowed again after `REJECTED`. |
| Download | `POST /v1/jobs/:id/download` (the call that stamps `downloadedAt`) is blocked while `PENDING` or `APPROVED`; allowed again after `REJECTED`. `GET /v1/jobs/:id/result` stays open so a pending image can still be viewed. |
| Amount | The net amount actually debited for the job according to the ledger (`-SUM(delta)` over `credit_ledger` rows for that job and user), **not** `jobs.creditsCharged`, snapshotted at request time. No partial refunds. |
| Outcome | Status chip on the tile (with admin note) plus an email on decision. |
| Scope | Catalogues-web user jobs only. Shopify and merchant-widget jobs bill a store balance and are out of scope. |

Out of scope: partial refunds, batch-level requests, appeals, admin notification emails.

## Data model

New table `refund_requests` (migration `0221`; `0220` is the latest on `dev`):

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `job_id` | uuid, **unique**, references `jobs` — enforces one request per job |
| `user_id` | uuid, references `users` |
| `credits` | integer, snapshot of the job's net ledger debit (`-SUM(delta)`) at request time |
| `reason_code` | text, one of the fixed codes below |
| `note` | text, nullable, max 300 chars |
| `status` | text: `PENDING` / `APPROVED` / `REJECTED`, default `PENDING` |
| `admin_note` | text, nullable (required on reject) |
| `reviewed_by` | uuid, nullable — the admin's `users.id` (same convention as `credit_ledger.adminId`) |
| `reviewed_at`, `created_at` | timestamptz |

Index on `(status, created_at)` for the admin list. `credit_requests` is deliberately not reused:
it is a user-level top-up request with no job link.

Reason codes (shared Zod enum in `packages/types`): `WRONG_GARMENT`, `DISTORTED_BODY`,
`FACE_MISMATCH`, `BACKGROUND_OR_POSE`, `POOR_QUALITY`, `OTHER`.

## API (`apps/api/src/modules/jobs/refund-requests.ts`, wired in `server.ts`)

- `POST /v1/jobs/:id/refund-request` — body `{ reasonCode, note? }`. Re-checks every eligibility
  rule server-side (including the ledger net, read inside the same transaction that locks the
  job); 404 for another user's job, 409 for ineligible. Rate-limited per user.
- `GET /v1/jobs/refund-status?jobIds=…` (max 50 ids) returns `{ items: [{ jobId, eligible, request }] }`,
  so tiles render status without per-tile fetches. Ledger nets for all owned jobs come from one
  grouped query. The web hook chunks lookups into groups of 50 (batches can reach 200 jobs) and
  polls every 45s only while a request is `PENDING`. There is no per-job GET for a request; the
  batched status route is the only read.
- Eligibility lives in one function, `refundIneligibility`, shared by both routes so the button and
  the server cannot disagree.
- `regenerateJob` (`modules/jobs/regenerate.ts`) throws 409 when a request exists in `PENDING` or
  `APPROVED`.
- `POST /v1/jobs/:id/download` returns 409 `REFUND_REQUESTED` while `PENDING` or `APPROVED`, checked
  **before** it stamps `downloadedAt`, so a blocked download never marks the job downloaded.
  `GET /v1/jobs/:id/result` is not gated, so a pending image can still be viewed.
- `POST /v1/jobs/:id/export/google-drive` (`modules/google-drive/service.ts`) is gated the same
  way (409 `REFUND_REQUESTED`, checked before anything leaves storage), and a successful export
  stamps `downloaded_at` with the same `coalesce(downloaded_at, now())` — an export hands the
  customer the image just like a download.

Request/response shapes live in `packages/types` (Zod, single source of truth).

## Admin API (`apps/api/src/modules/admin/refund-requests.routes.ts`)

- `GET /admin/refund-requests?status=` — `credits.read`. Rows carry user, job, credits, reason,
  note and a result thumbnail URL.
- `POST /admin/refund-requests/:id/approve` and `/reject` — `credits.write`.

**Approve**, one Postgres transaction: lock the request row `FOR UPDATE`, require `PENDING`,
credit the user with reason `REFUND_USER_REQUEST`, set `APPROVED` + `reviewed_*`, then
`recordAudit(tx, ...)` (fail-closed, per the audit invariant). The ledger's unique
`(job_id, reason)` index makes the credit at-most-once even under two concurrent approvals.
`ledger.ts`'s `refund()` opens its own transaction, so the plan must add a variant that accepts a
`tx` (or extract the insert+balance update) — the status flip and the credit must commit together.

Approve also re-checks `downloaded_at IS NULL` inside the transaction: if the customer downloaded
the result after filing (e.g. via a path that predates the request), it returns 409
`ALREADY_DOWNLOADED` and the admin should reject instead.

Approve then locks the job row `FOR UPDATE` (the same lock admin-cancel refunds take), requires
the job still `COMPLETED`, and recomputes the ledger net for (job, user): it requires
`-net >= credits`, otherwise 409 `NOT_REFUNDABLE` (credits already refunded or never charged).
This closes the double refund where an admin cancel or a dispatcher terminal refund
(`REFUND_ADMIN_CANCEL`, `JOB_FAIL_REFUND`, `JOB_CANCEL_REFUND`) already returned the credits — the
`(job_id, reason)` index only stops a second credit under the *same* reason. It then credits
exactly the snapshotted `credits`.

**Reject**: same lock and audit; requires `admin_note`; no ledger entry.

The email is sent after commit, best-effort via `lib/mailer.ts`; a failed send never rolls back a
decision. Tests mock the mailer, and a test covers the best-effort behaviour (a rejected send
still leaves the decision committed).

## Customer UI (`apps/catalogues-web/src/app/(app)/studio/generation-panel.tsx`)

- "Request refund" button next to Regenerate on each completed, eligible tile.
- Modal: reason via `PremiumSelect`, optional note, warning that the image cannot be downloaded
  until the request is decided. Colours from `C` tokens, no raw hex.
- After submit, a status chip: Pending / Approved (credits refunded) / Rejected (admin note).
  Regenerate, Download and Save to Drive are disabled while Pending and Approved.
- Gated by a flag in `lib/feature-flags.ts` (like `REGENERATE_ENABLED`) so it can ship dark.

## Admin UI (`apps/admin-web`)

New "Refund requests" page: status filter (default Pending) using `SearchableSelect`, list with
result thumbnail, detail with Approve / Reject and admin note. The status filter is local
state; only the open request is a URL param (`?request=`, per `docs/admin-url-routing-standard.md`).
Reason labels come from `@aivastra/types` (`REFUND_REASON_LABELS`), and the admin note resets
whenever the open request changes, since it is emailed to the customer. Sidebar entry and route in `App.tsx`.

## Testing

- API integration (harness `buildTestApp`): eligibility matrix (not owner, not completed,
  downloaded, `creditsCharged = 0`, Shopify job, unlimited-plan job with a delta-0 ledger row,
  duplicate request); the snapshot equals the ledger debit when it differs from `creditsCharged`;
  approve credits exactly once under two concurrent calls, and refuses (409 `NOT_REFUNDABLE`,
  nothing credited) when a prior `REFUND_ADMIN_CANCEL` already offsets the debit or the job is no
  longer `COMPLETED`; reject writes no ledger row; permission checks; audit row written and rolls
  the approval back if the audit insert fails; regenerate and result-download 409 while
  Pending/Approved and allowed after Rejected, with `downloadedAt` still null after a blocked
  fetch; Google Drive export 409 while a request is open and stamps `downloadedAt` on success.
- Unit: Zod schemas and reason enum (`packages/types/src/refund.test.ts`).
- Web: **no automated tests.** `apps/catalogues-web` has no test runner, so the tile states
  (none / pending / approved / rejected) and the Download / Save to Drive gating are covered only
  by typecheck and lint, plus a manual check that has not yet been performed.

## Rollout

Migration through push → CI/CD → `db:migrate:prod`, nothing ad hoc on production. Web flag off by
default; enable on staging first. Record the flag and any new env in `docs/progress.md`.

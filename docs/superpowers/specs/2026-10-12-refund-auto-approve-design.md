# Refund auto-approve toggle — design

**Date:** 2026-10-12
**Status:** design approved in conversation, not yet implemented
**Builds on:** `2026-10-12-refund-on-request-design.md` (merged in PR #522). Everything here assumes that
feature: the `refund_requests` table, `applyRefundTx`, `adminApproveRefundRequest`, and the
customer create route in `apps/api/src/modules/jobs/refund-requests.ts`.

## Goal

An admin can switch on **auto-approve** from the admin panel. While it is on, a customer's refund
request that passes the normal checks is approved the moment it is submitted, with no admin
action. An admin can switch it off again at any time.

## Decisions

| Question | Decision |
|---|---|
| What does ON do? | New requests only, approved instantly. Requests already `PENDING` when it is switched on stay pending for manual review. |
| Safeguard | A per-user daily cap on auto-approvals (default 5, editable). Past the cap, a request is left `PENDING` for a human. |
| Who can change it | `credits.write` (the capability that already lets an admin approve by hand). Anyone with `credits.read` can see the state. |
| Default | OFF, cap 5. |
| Storage | Redis key `config:refund-auto-approve`, like `config:image-compression`. No migration for the setting itself. |
| Failure mode | Any problem auto-approving leaves the request `PENDING`. The customer's request never fails because of it. |

## Setting

`{ enabled: boolean, dailyCap: number }`, stored as JSON under `config:refund-auto-approve`.
Missing, malformed or unreadable (Redis down) ⇒ `{ enabled: false, dailyCap: 5 }`, i.e. the safe
state. `dailyCap` is an integer 1–100. The shape is a Zod schema in `packages/types`
(`RefundAutoApproveConfig`, `RefundAutoApprovePatch`) and a defaults-filling reader
`getRefundAutoApproveConfig(redis)` in `apps/api/src/lib/refund-auto-approve-config.ts`.

## Data model

One new column on `refund_requests` (migration `0223`):
`auto_approved boolean not null default false`.

It is set only by the auto path. It is what the daily cap counts and what the admin page shows as
an "Auto" badge. (Inferring "auto" from a null `reviewed_by` was rejected: it is implicit and would
silently change meaning if a manual path ever stopped setting the reviewer.)

## API

Admin routes in `apps/api/src/modules/admin/refund-requests.routes.ts`:

- `GET /admin/refund-requests/auto-approve` — `credits.read`. Returns the config.
- `PATCH /admin/refund-requests/auto-approve` — `credits.write`. Body is a partial
  `{ enabled?, dailyCap? }`, merged onto the current config. Writes an audit row
  (`refund_auto_approve.update`, resource type `system_config`, resource id `refund_auto_approve`,
  `before` / `after`) **before** the Redis write lands, in the same ordering the image-compression
  route uses, so a change can never occur without an audit entry.
- The list endpoint returns `autoApproved` per row.

## Behaviour

Auto-approval runs **inside `createRefundRequest`'s existing transaction**, after the normal
eligibility checks pass and the row is inserted, so the request, the refund and the audit row
commit together or not at all.

1. Read the config. If `enabled` is false, stop (the request stays `PENDING`).
2. Count the user's requests with `auto_approved = true` and `reviewed_at` in the last 24 hours. If
   the count is `>= dailyCap`, stop (stays `PENDING`).
3. Otherwise run the **same approve logic the admin button uses**. That logic is extracted from
   `adminApproveRefundRequest` into one shared function (`approveRefundRequestTx(tx, row, actor,
   opts)`) used by both paths, so they cannot diverge: re-check job `COMPLETED`, no regenerated
   child, `downloaded_at IS NULL`, ledger net `-net >= credits`, credit through `applyRefundTx`
   (reason `REFUND_USER_REQUEST`), set `APPROVED`, `reviewed_at = now`, `adminNote =
   'Auto-approved'`, `auto_approved = true`, then `recordAudit`.
4. The auto path runs in a **savepoint**. If it throws for any reason, the savepoint rolls back and
   the request is left `PENDING` (logged with `app.log.warn`). The create call still succeeds.

Audit: `audit_logs.actor_user_id` is required and must reference a real user, so the actor is the
**requesting customer** with role `AUTO_APPROVE` and action `refund_request.auto_approve`. No admin
is involved in an auto-approval.

After commit the customer gets the existing "approved" decision email (best effort). The create
response carries `status: 'APPROVED'` when auto-approved, so the UI's status refetch shows the
approved chip with no extra work. The Prometheus `creditsRefundedTotal` counter is incremented
after commit, exactly as for a manual approval.

A manual `PENDING` request filed while the toggle was off is unaffected by switching it on.

## Admin UI (`apps/admin-web`, Refund requests page)

- A card at the top: a switch labelled "Auto-approve refund requests", a number field "Max per
  customer per day", and the hint "Approved instantly; credits are returned immediately."
- Everyone with `credits.read` sees the state; the controls are disabled without `credits.write`.
  Turning it ON asks for confirmation (it moves money without review). Turning it OFF applies
  immediately.
- Rows show an "Auto" badge when `autoApproved`; the approved detail reads "Auto-approved".
- Dropdowns (none needed) would use `SearchableSelect`; the page keeps its URL-state conventions.

## Testing

API integration (harness `buildTestApp`, mailer mocked as in the existing refund tests):

- OFF: a request stays `PENDING`; no credit.
- ON: a request is `APPROVED` at once, credited once, `auto_approved = true`, audit row
  `refund_request.auto_approve`, response status `APPROVED`, email attempted once.
- Daily cap boundary: with cap N, the Nth request auto-approves and the N+1th stays `PENDING`;
  manual approvals do not count toward the cap; requests older than 24h do not count.
- Ineligible requests (unlimited-plan job, regenerated, downloaded, already requested) are still
  rejected at create time and never auto-approve.
- A forced failure inside the auto path (e.g. a prior `REFUND_ADMIN_CANCEL` ledger offset making the
  net check fail) leaves the request `PENDING`, with no credit and a 201 response.
- Switching ON does not approve requests that were already `PENDING`.
- `GET`/`PATCH` auth: 401 unauthenticated, `PATCH` 403 for a role without `credits.write`, audit row
  written on `PATCH`, and invalid bodies (`dailyCap` 0 or 101) return 400.
- The shared approve function: the existing admin approve tests continue to pass unchanged.

Admin-web has no test runner; verification is the admin build and lint.

## Rollout

Migration `0223` (additive) through push → CI/CD → `db:migrate:prod`; nothing ad hoc on production.
The setting defaults to OFF, so shipping changes no behaviour until an admin flips it. No new
environment variables. Record the setting and its Redis key in `docs/progress.md`.

## Out of scope

Delayed auto-approve after a wait, approving the existing backlog when switched on, a per-request
credits ceiling, admin notification emails, and per-customer allow/deny lists.

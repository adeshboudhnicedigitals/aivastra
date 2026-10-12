# Admin notification panel — design

**Date:** 2026-10-12
**Status:** design proposed, not yet implemented
**Decisions (from conversation):** general feed (refund requests, contact requests, job
failures, workers); no new backend feed — the panel polls endpoints that already exist,
read-state lives in `localStorage` (per browser, not cross-device).

## Goal

An admin sees a bell in the admin topbar (right-side tools, before the theme toggle —
`apps/admin-web/src/components/Topbar.tsx`, `Icon.Bell` already exists) with an unread
badge. Clicking it opens a right-anchored dropdown panel with the latest actionable items;
each item links to its page. No new database table, no new API resource, no migration.

## Data sources (all existing, all polled client-side)

| Section | Source | Permission | Items for panel |
|---|---|---|---|
| Refund requests | `GET /admin/refund-requests?status=PENDING&limit=5` | `credits.read` | id, credits, userEmail, createdAt |
| Contact requests | `GET /admin/contact-requests/unread-count` for the badge + `GET /admin/contact-requests` (latest) for items | `contact.read` | server already tracks contact read-state — reuse it, do not duplicate in `localStorage` |
| Job failures | `GET /admin/stats` → `recentFailures` (5 latest: id, errorCode, createdAt, userEmail) + `stuckJobs` | `config.read` | failures first, stuck jobs after |
| Workers | `GET /admin/stats` → `workersHealthy` / `workersTotal`; per-worker identity via `GET /admin/workers` only when the panel is open | `workers.read` (list) / `config.read` (stats) | offline workers by id |

One small additive backend change (no migration, no new route): add a
`pendingRefundRequests` `COUNT(*)` to the existing `Promise.all` in `GET /admin/stats`
(`apps/api/src/modules/admin/config.routes.ts`), so the badge has a true pending total
instead of a capped `limit=50` list count. If review prefers zero backend touch, the
fallback is counting a `limit=50` pending list with a "50+" cap — recorded here so the
implementer does not have to re-decide.

## Behaviour

- **Bell + badge:** visible when the admin holds any of the four read permissions above.
  Badge = unread refunds + unread contacts + new failures since seen + offline workers.
  Polled every 30 seconds (badge only; the Sidebar's 5s chat/contact badges are the
  precedent for silent-catch polling, but four sources at 5s is too chatty — 30s plus a
  refresh on every panel open/close). A 403 on any source hides that section, never an
  error toast (same rule as the refund toggle card's 403-hide).
- **Read-state:** `localStorage` key `aivastra-notif-seen` =
  `{ refunds: iso|null, failures: iso|null, workers: iso|null }` (contacts reuse the
  server's read-state). An item is unread when its `createdAt` is newer than its
  section's mark. Opening the panel marks every visible section seen (badge clears on
  close); per-item "mark read" is out of scope.
- **Panel:** right-anchored dropdown under the bell (closes on outside click / `Escape`,
  reusing the overlay conventions; no new URL params). Sections in fixed order —
  refunds, contacts, failures, workers — each with a header count and max 5 items, then
  a "View all" link to the page. Empty state per section ("No pending requests"), and an
  all-clear state when everything is zero.
- **Deep links (follow each page's URL convention):** refund item →
  `/refund-requests?request=<id>` (existing `useUrlState` param); contact →
  contacts page selection if it has one, else the page; failure → jobs page filtered to
  the job if supported, else the jobs page; worker → workers page.
- **Out of scope:** email/Slack alerts (Settings still shows "Coming soon"), sound on new
  items (the sound toggle covers failures/warnings only and stays as-is), per-item mark
  read, cross-device read-state, customer-side notifications (decision emails already
  exist), any new backend table or route.

## Testing

- Admin-web has no test runner: verification is build + lint + manual click-through
  (badge appears/clears, 403-hides a section for a role without that perm, links land on
  the right rows, poll cadence observed in devtools).
- API: one integration assertion that `/admin/stats` returns `pendingRefundRequests`
  matching a seeded PENDING row (extend the existing stats/config test file, no new
  harness). No other backend tests needed.

## Rollout

New branch `feat/admin-notifications` from `origin/dev` (the refund list endpoint it
reads shipped in PR #522, so no stacking needed). No migration, no env vars. Record the
`localStorage` key and the new stats field in `docs/progress.md`.

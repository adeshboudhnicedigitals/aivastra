# v1.0 step 2: devices, in-store sessions, entitlement (credits only)

Step 2 of `docs/architecture/v1-hld.md` §10. Builds on step 1 (org model: branches, staff,
`requireMerchantMember`, migration 0255). Status: design approved in conversation 2026-11-06.

## Compatibility rule (binding)

Nothing in step 2 may change behaviour for existing customers. Old customers are migrated
slowly and on our schedule, so:
- Every schema change is additive (new tables, nullable columns). No existing column, table,
  default or constraint is altered or dropped.
- Existing routes, auth paths, request/response shapes, pricing and credit charging for the
  legacy kiosk and merchant flows are unchanged. New behaviour lives only on new `/v1/device/*`
  and new org/admin device routes.
- `createMerchantTryonJob` gains only optional attribution parameters. Called as today, it
  behaves identically, and a test pins that.
- The legacy email-login kiosk path is never switched off by this work. Any sunset is a
  separate, later decision made per customer.

## Decisions

1. **Legacy kiosks stay (additive).** Existing Android kiosks log in with email + password
   (`platform: 'kiosk'`). That path keeps working exactly as today and its try-ons stay charged
   to credits with null branch/device/session attribution. Paired devices are the new path;
   customers move over gradually. No automatic switch-off.
2. **Plumbing only.** No shopper OTP, consent, `shoppers` table, shopper page or WhatsApp link
   (step 5). `instore_sessions` has no `shopper_id` or consent columns; step 5's migration adds
   them. No dashboards (step 3), no Android UI (step 4).
3. **`kiosk_result_likes` / `kiosk_result_cart_items` are not dropped.** Old builds still use
   them through `/v1/merchant/tryon/jobs/:jobId/like|cart`. Replacement by `session_items` and
   the drop migration belong to the sunset, after a read-only production row-count check.

## Data model (one migration)

| Table | Columns | Notes |
|---|---|---|
| `merchant_devices` | id, merchant_id (cascade), branch_id, name, device_token_hash (unique, nullable until paired), pairing_code_hash, pairing_expires_at, last_seen_at, is_active, created_at, updated_at | sha256 hashes like `api_keys`. Token shown once. Index on (branch_id, is_active) |
| `instore_sessions` | id, merchant_id, branch_id, device_id, staff_id (nullable), mode (`kiosk`\|`assisted`), started_at, ended_at, last_activity_at | Index on (device_id, ended_at) for the idle sweeper |
| `session_items` | id, session_id, catalog_item_id, job_id (nullable), action (`tried`\|`wishlisted`\|`sold`), staff_id (nullable), voided_at, voided_by, created_at | Undo sets `voided_at`, never deletes |

`jobs` gains nullable `branch_id`, `device_id`, `session_id`, `staff_id`. Legacy try-ons leave them null.

## Device auth

`app.requireDevice` (in `plugins/portal-auth.ts`, next to `requireMerchantMember`): reads
`Authorization: Device <token>`, sha256s it, finds an active `merchant_devices` row whose branch
and merchant are also active, sets `req.device = { deviceId, merchantId, branchId }` and updates
`last_seen_at`. Anything else is 401 `DEVICE_INACTIVE`. Existing `requireMerchant`,
`requireMerchantMember` and email login are untouched. Every query on a device route is scoped by
`merchant_id` from the device row, never from the request.

## API

Merchant admin (and staff, read-only, own branch):
- `POST /v1/merchant/org/devices` {branchId, name} (admin) → device + one-time pairing code (15 min).
- `GET /v1/merchant/org/devices` (admin: all; staff: own branch).
- `PATCH /v1/merchant/org/devices/:id` {name?, branchId?, isActive?} (admin). Moving to a branch
  verifies it belongs to the same merchant (404 otherwise).

AiVastra admin (`requireAdmin(['SUPER_ADMIN','ADMIN'])`, audited; GET on `merchants.read`):
- `GET /admin/merchants/:id/devices`, `PATCH /admin/merchants/:id/devices/:deviceId`.

Device:
- `POST /v1/device/pair` {code}: unauthenticated, rate-limited per IP. Consumes the code with an
  atomic `UPDATE … WHERE pairing_code_hash = $1 AND pairing_expires_at > now() AND
  device_token_hash IS NULL RETURNING …` so two tablets cannot claim one code, then returns the
  token once. Wrong, expired and reused codes return the same 400.
- `POST /v1/device/sessions` {mode}: kiosk, or assisted when the request also carries the staff
  member's ordinary access JWT (from the normal email login) in `X-Staff-Authorization: Bearer …`.
  It is resolved with the same logic as `requireMerchantMember`; the staff member must be active
  and their branch must equal the device's branch (else 403). Idempotent (`withIdempotency`).
- `POST /v1/device/sessions/:id/end`; items: `POST /v1/device/sessions/:id/items`
  {catalogItemId, action: wishlisted|sold} and `DELETE …/items/:itemId` (undo a sale: the staff
  member who made it within 24 h, merchant admin any time).
- `POST /v1/device/tryon/jobs`: reuses `createMerchantTryonJob`, passing branch/device/session/
  staff IDs; writes the `tried` `session_items` row in the same transaction.

Idle sweeper `startInstoreSessionSweeper` (registered in `main.ts`, exports its tick): ends
sessions idle for 10 minutes.

## Entitlement

`chargeInStoreTryon(tx, ctx)` inside the existing job-creation transaction:
1. `isDeviceCovered(deviceId)`: returns `false` until the subscription module ships. If it
   throws or times out, treat as not covered.
2. Not covered → `atomicMerchantDeduct` against the merchant's credits.
3. Insufficient credits → 402 `INSUFFICIENT_CREDITS` before any job row is written; the merchant
   gets the existing low-credit email (no new alert loop).

`device_quota_per_month` (step 1 column) is read only once `isDeviceCovered` can return true;
the quota branch is not built in step 2. Credit deduct + job insert remain one transaction;
refund on terminal failure is unchanged.

## Security and audit

Token hashed at rest and redacted in logs; rotating means re-pairing. Device create, pair,
deactivate, move, session start/end and sale undo each call `recordAudit(tx, …)` in the same
transaction (fail-closed). No limit on devices per branch (HLD allows many).

## Testing (integration, docker-compose harness)

Pairing: happy path, reused code, expired code, concurrent claims (exactly one wins), per-IP rate
limit. Device auth: deactivated device/branch/merchant rejected on the next request. Sessions:
assisted with another branch's staff refused; undo by staff within 24 h allowed, after refused;
admin undo any time. Entitlement: credits deducted; 402 and no job row when empty;
`isDeviceCovered` throwing still charges credits. Tenancy: a cross-merchant attempt for every
endpoint. Legacy: an email-login try-on still works with null attribution, and
`createMerchantTryonJob` called without the new parameters charges and inserts exactly as before. Admin routes: role
gating for SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT.

## Out of scope

Shopper OTP/consent/`shoppers`; shopper page and WhatsApp link; dashboards; Android UI;
subscription coverage and quota enforcement; dropping `kiosk_result_*`; removing the legacy
kiosk login.

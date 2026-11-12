# CRM Phase 2: Shopper Identification on the Merchant's WhatsApp (mode A) Implementation Plan

**Goal:** At the end of an in-store session the tablet shows "Get these looks on WhatsApp". The
shopper scans a QR that opens WhatsApp to **the brand's own number** with `LOOKS <code>` prefilled
and presses send. That message proves the number, opens the 24-hour window, and the API replies
from the brand's number: a consent question (looks, plus an optional marketing opt-in), then the
looks. The shopper becomes a per-merchant customer record with versioned consents.

**Spec:** `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §3 (roles, consent),
§4 + §4.1 (A1–A4), §5 (at-end flow). **Builds on:** the analytics foundation and the device-mode
test app.

## Decisions this plan makes

| # | Decision | Why |
|---|---|---|
| C1 | **One new secret, `CRM_DATA_KEY`** (32 bytes base64); HKDF derives separate subkeys for channel credentials, phone encryption and the phone lookup hash | One key to provision per environment; separate subkeys, so a leaked hash key does not decrypt numbers |
| C2 | **Gated by `CRM_IDENTIFY_ENABLED` (`=== true`), default off** | Production behaviour is unchanged until it is switched on deliberately |
| C3 | **Identification is available only when the merchant has a connected channel AND has chosen retention** (spec Q4: no default). Otherwise the tablet offers only the QR download (mode C) | The merchant is the Data Fiduciary; no data is collected before they have set how long it is kept |
| C4 | **Merchant-channel webhooks go to their own Redis stream (`crm:inbound`) and consumer**, never into the seller conversation engine | A shopper texting a brand must never reach the catalogue-seller bot, and vice versa |
| C5 | **Consent wording ships as version `v0-draft`** and is flagged for legal review (spec Q6, DPA) | Legal copy is not an engineering decision; the version column lets the reviewed text replace it with history intact |
| C6 | **Looks are sent as image messages by link** (fresh 24h presigned URLs) inside the window the shopper opened | No template, no media upload round-trip |

## Tasks

### Task 1: Schema, types, env
- [x] `merchant_whatsapp_channels` (one per merchant; `phone_number_id` unique; WABA id, display number, token and app secret encrypted; `status`, `connected_at`, `connected_by`).
- [x] `merchant_crm_settings` (merchant pk; `identify_at` `end|start` default `end`; `photo_retention_days`, `profile_retention_days` nullable until chosen; `consent_version`).
- [x] `shoppers` (per merchant, `phone_enc`, `phone_hash` unique per merchant, first/last seen, `deleted_at`), `shopper_consents` (append-only: kind `looks|marketing`, granted, version, source).
- [x] `instore_sessions.shopper_id` (nullable, `on delete set null`).
- [x] Analytics: server events `shopper_identified`, `consent_recorded`, `looks_sent`; client `identify_shown` (allowlist).
- [x] Env `CRM_DATA_KEY`, `CRM_IDENTIFY_ENABLED`; migration `0265`. *(Done 2026-11-12: migration `0265_crm_shopper_identification`, additive; applied locally.)*

### Task 2: Crypto
- [x] `modules/crm/crypto.ts`: HKDF subkeys; `sealSecret/openSecret`, `encryptPhone/decryptPhone`, `phoneHash` (HMAC-SHA256 of E.164 digits). Unit tests: round-trip, distinct ciphertexts, stable hash, wrong key fails. *(Done: `modules/crm/crypto.ts`, 5 unit tests.)*

### Task 3: Channel connect + CRM settings (merchant admin)
- [x] `GET/PUT/DELETE /v1/merchant/whatsapp-channel`: PUT validates the credentials against the Graph API (`GET /{phone_number_id}?fields=display_phone_number`) before saving; secrets never returned; audited.
- [x] `GET/PUT /v1/merchant/crm-settings`: retention bounds (photos 1–365 days, profiles 30–1095), `identify_at`.
- [x] Tests with a stubbed Graph fetch: bad token → 422 nothing saved; secrets absent from every response; staff 403; another merchant's `phone_number_id` already connected → 409. *(Done: `crm/settings.routes.ts`, `crm/channel.ts`; `crm-settings` 8 tests.)*

### Task 4: Identify start/status (device)
- [x] `POST /v1/device/sessions/:id/identify` → `{ code, waLink, expiresAt }` (Redis, 15 min, bound to session) or 409 `IDENTIFY_UNAVAILABLE` with `fallback: 'qr'` (C3). `GET` → `pending | verified | expired`. *(Done: `crm/identify.ts`; one live code per session, 30-minute grace after the session ends.)*

### Task 5: Webhook routing and the shopper conversation
- [x] Parser gains `phoneNumberId`. Webhook: a body for a connected channel is verified with **that channel's** app secret and queued on `crm:inbound`; anything else follows the existing path unchanged.
- [x] Consumer: `LOOKS <code>` → upsert shopper (hash lookup), link the session, ask consent (buttons: "Send my looks" / "Looks + offers"); a button reply records consents (versioned) and sends the session's finished looks; `STOP` revokes marketing. Events per C1/Task 1.
- [x] Tests (stubbed Graph): signature with the wrong secret 401; code redeemed once; second shopper with the same code gets "expired"; consent rows; looks sent only for this session's completed jobs; STOP; a seller-lane message still reaches `messaging:inbound`. *(Done: `crm/webhook.ts` (routing before the seller path), `crm/inbound.ts`, `crm/consumer.ts` (own Redis connection for XREADGROUP BLOCK; started in `main.ts` only when the flag and key are set). `crm-identify` 12 tests; seller-lane suites `messaging- whatsapp- admin-whatsapp` unchanged and passing.)*

### Task 6: Retention
- [ ] Hourly sweeper: shoppers past `profile_retention_days` since last visit → profile deleted (phone wiped, consents kept anonymised), session link nulled. Photo retention applied to identified sessions' customer photos and results. Dry-run count logged before delete.
  *(Profile half done 2026-11-12: `crm/retention.ts`, `crm-retention` 3 tests. **Photo half not built**: scope is an open product question, see `docs/progress.md`.)*

### Task 7: Tablet + merchant-web
- [x] Tablet: on session end, "Get these looks on WhatsApp" QR (polls status), QR download always offered; `identify_shown`.
- [x] Merchant-web Settings: WhatsApp connection form and CRM settings (retention required before identification switches on). *(Done 2026-11-12: `WhatsappLooksButton` on the tablet Download screen; `CustomerDataSettings` on merchant-web Settings with `lib/crm-form.ts` (5 tests). Not opened in a browser or on a device.)*

### Task 8: Records and verification
- [x] *(2026-11-12: CLAUDE.md loops/schema/invariants/env, `.env.production.example`, `docs/progress.md`.)*

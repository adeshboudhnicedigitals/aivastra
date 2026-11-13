# Merchant Android: device mode (test app) Implementation Plan

**Goal:** Move the Merchant Android **test app** (`apps/virtual_tryon_android_merchant`) from owner
login + `/v1/merchant/tryon/*` onto the v1.0 device model: pairing code → device token, in-store
sessions (kiosk and assisted), the device try-on API, wishlist/sold, and analytics event upload. This
is HLD build-order step 4 and the prerequisite for CRM phase 2's session-end screens (spec §4.1 A4).

**Spec:** `docs/architecture/v1-hld.md` §3.2, §5.1–5.3; `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §9
(device contract, idempotency, client event ids).

**Not touched:** `apps/virtual_tryon_android_multi_flow` (the shipped app) and its owner-login API.

## Decisions this plan makes

| # | Decision | Why |
|---|---|---|
| M1 | **The test app is device-mode only.** Owner login, onboarding, reports, profile/credits and renewal screens leave its navigation | It exists to develop the merchant tablet; two auth modes in one test app doubles every path for no user |
| M2 | **Add device twins of the read/photo routes the app needs** (`/v1/device/catalog`, `/catalog/subcategories`, `/tryon/photo-url`, `/tryon/upload-sessions`) sharing the merchant handlers' logic | The device token is the only credential on a shared tablet; the owner's JWT must not live on it |
| M3 | **Staff sign in on the tablet with `/v1/auth/login` (the merchant-web login); the access token is held in memory only and sent as `x-staff-authorization`. No refresh token on the device: an expired token means sign in again** | *Revised in execution:* `login-mobile`/`refresh-body` are the AiVastra admin app's login (admin users only, admin-audience token). The server reads the staff header only at assisted-session start and at the seller's undo, so a 15-minute token covers the start, and a later undo re-asks. A shared tablet should not hold a long-lived staff credential anyway |
| M4 | **Quick Try-On is hidden in device mode** | A session `tried` row needs a catalog item; quick try-on has none. Needs its own attribution rule, a later change |
| M5 | **Events are queued on disk and uploaded in batches** (≤100, every 30s and at session end), each with a client UUID | Spec §9: offline-safe, server dedupes on `(device_id, client_event_id)` |
| M6 | **Device job status gains `shareUrl`** (same value as `resultUrl`) | The app's `TryOnStatusResponse` reads `shareUrl`; additive, nothing else reads it |

## Tasks

### Task 1: Server device twins
**Files:** `apps/api/src/modules/device/catalog.routes.ts` (create), `upload-sessions` + `photo-url` device routes, `server.ts`. Test: `device-catalog.test.ts`.
- [x] Extract the merchant catalog list/subcategory queries so both route families call one function.
- [x] `GET /v1/device/catalog`, `GET /v1/device/catalog/subcategories` (`requireDevice`, merchant from token, same `includeDemo` rule).
- [x] `GET /v1/device/tryon/photo-url` (key must be under the device merchant's input prefix), `POST/GET /v1/device/tryon/upload-sessions[/:token]` (session bound to the merchant, same store).
- [x] `shareUrl` on `GET /v1/device/tryon/jobs/:id`.
- [x] Tests: device sees its merchant's items only; another merchant's photo key 403; upload session of another merchant 404; deactivated device 401; job status carries `shareUrl`. *(Done 2026-11-12: `device/tablet.routes.ts`; catalog reads extracted to `listCatalogItems` / `listCatalogSubcategories` in `merchant/catalog.routes.ts`. `device-tablet` 5 tests pass, incl. device output == owner output; the 8 `merchant-catalog*` suites (69 tests) still pass; typecheck and biome clean.)*

### Task 2: Device identity on Android
- [x] `DeviceStore` (token, device/branch/merchant names from `/v1/device/me`) in private SharedPreferences.
- [x] `DeviceApiService` + OkHttp interceptor: `Authorization: Device <token>`, optional `x-staff-authorization`; a 401 `DEVICE_INACTIVE` clears the token and returns to pairing.
- [x] `PairingPage` (code entry → `POST /v1/device/pair`), Splash routes to it when unpaired. *(Done 2026-11-12: `device/DeviceStore.kt` (+ `StaffSession`), `device/DeviceApi.kt`, `ApiClient` rewritten to the device token with the staff header only on session start/undo, `PairingPage`; the inherited `signin` route renders pairing so every "sign in again" path lands there.)*

### Task 3: Sessions, catalog and try-on through the device API
- [x] `InstoreSession` holder: start (`Idempotency-Key`), end on Done/exit, local idle end mirroring the server's 10 minutes.
- [x] Catalog, presign, photo-url, upload-session and job create/status repositories switched to `DeviceApiService`; job create sends `sessionId`.
- [x] Owner-only screens and Quick Try-On removed from navigation (M1, M4). *(Done 2026-11-12: `device/InstoreSession.kt`; session starts on category pick and ends on return home; `TryOnRepository` sends `sessionId` + `Idempotency-Key` and reopens a session once on `SESSION_ENDED`. Home menu: owner entries, plan card and Quick Try-On removed; staff sign in/out and Unpair added.)*

### Task 4: Assisted mode
- [x] Staff sign-in sheet (`/v1/auth/login`, token in memory), re-sign-in when it has expired, sign-out ends the staff session.
- [x] Result page: **Wishlist** (both modes) and **Sold** (assisted only), with the 24h undo for the seller. *(Done 2026-11-12: `StaffSignInDialog` (`/v1/auth/login`), `SessionItemBar` overlaid on the single result and on each finished multi-result tile (new `tileActions` slot); Sold only in assisted sessions, seller undo needs a valid staff token.)*

### Task 5: Event queue
- [x] File-backed queue, `item_viewed` / `category_viewed` / `qr_shown` emitted from the existing screens, batch uploader with backoff; the server's `rejected`/`dropped` events are removed, never retried.
- [x] JVM unit tests for the queue (persistence, batching, replay safety). *(Done 2026-11-12: `device/EventQueue.kt` (pure JVM, 8 JUnit tests pass) + `EventReporter` (30s flush, exponential backoff to 5 min, flush at session end); `category_viewed` on category pick, `item_viewed` on garment detail, `qr_shown` for the download and phone-upload QRs.)*

### Task 6: Verification and records
- [x] `./gradlew assembleDebug testDebugUnitTest`; API integration suites; a curl script driving the same sequence the app runs.
- [ ] On-device run against the local API if an emulator image or a tablet is available; otherwise say so.
- [x] `docs/progress.md` entry; HLD build-order step 4 note. *(Done 2026-11-12 except on-device: `assembleDebug` + `testDebugUnitTest` pass. The app's request sequence driven against the local API (`device_flow.py`, `assisted_flow.py` in the session scratchpad): pair, used code 400, catalog, idempotent session start, QR upload session, presign + PUT + preview, idempotent job create, job status with `shareUrl`, wishlist, kiosk sale 409 `SOLD_REQUIRES_ASSISTED`, events accepted then all duplicates on resend, end, try-on on ended session 409; assisted: staff login, assisted start, start/undo without staff header 401 `UNAUTH`, sale + seller undo 200. Both sessions' `analytics_events` rows are complete and carry the session channel. **Not run on a device:** no emulator system image is installed and no tablet was connected.)*

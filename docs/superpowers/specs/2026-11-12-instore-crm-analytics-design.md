# In-store CRM, cart and analytics (design)

**Status:** Draft · **Date:** 2026-11-12
**Builds on:** `docs/architecture/v1-hld.md` (§3.2–3.3, §5.2–5.5), `2026-11-12-merchant-web-account-console-design.md`
**Supersedes the HLD on:** when the shopper is identified (HLD decision 2), the single shared WhatsApp
number (HLD decision 1), the staff-only "Sold" button as the sales source (HLD decision 8), and
dashboards computed from hand-written queries (HLD §5.5).

## 1. Goal

Make AiVastra a measurable business tool for retail chains, not only a try-on experience:
capture consented customer data **for the merchant**, turn in-store try-ons into real carts that
drive billing, and give HQ analytics that prove what AiVastra adds to the business.

## 2. Decisions (agreed 2026-11-12)

| # | Decision | Chosen |
|---|---|---|
| 1 | Delivery modes | **All three**, chosen per merchant: A merchant's own WhatsApp number, B shared AiVastra number branded per brand, C QR download with no data (§4). **Revised 2026-11-12: A is the primary path; B is not built in phase 2 (kept in the model only), C is always offered** |
| 2 | Who sets the mode | Merchant admin (merchant-web) **or** AiVastra admin (account console) |
| 3 | When the shopper is identified | **At the end of the session by default** ("get these looks on WhatsApp"). Per-merchant option to ask at the start |
| 4 | Sales source | **POS integration** (per-merchant connectors) is the target. Until it exists, an in-store **cart** that drives billing with real SKUs is the fallback (§6) |
| 5 | Analytics foundation | **One events table** with standard dimensions; every metric is derived from it (§7) |

## 3. Data roles and consent

- **The merchant is the Data Fiduciary; AiVastra is the Data Processor** (India DPDP Act 2023). We
  collect and store shopper data on the merchant's behalf, under a data processing agreement, and
  use it for nothing else. "AiVastra doesn't store customer data" is not accurate and must not
  appear in product copy. The accurate claim is "we hold it only for the brand".
- **Customer data is separate per merchant.** A shopper is unique on `(merchant_id, phone)`.
  Never joined across merchants, and no AiVastra-wide shopper profile (carries HLD §4.1).
- **Two consents, never bundled, each versioned and withdrawable:**
  1. `looks`: send my try-on images to WhatsApp (transactional).
  2. `marketing`: send me offers from [Brand] (optional, unticked by default).

  Meta's policy requires explicit opt-in for marketing messages. Bundling the two risks the sending
  number being restricted.
- **At rest:** phone numbers encrypted with AES-256-GCM (same scheme as Shopify tokens) plus a keyed
  hash column for lookup. Shopper photos are personal data: retention period per merchant (Q4),
  deletion on request, no face-based age or gender inference.
- **Access:** viewing or exporting the customer list is a separate permission, HQ (merchant admin)
  only by default, never branch staff. Every export audited.
- **Withdrawal:** replying STOP, or a link on the shopper page, revokes `marketing` immediately.
  Deletion removes the profile and photos and keeps anonymised event rows for analytics.

## 4. Delivery modes

| Mode | What happens at session end | Data captured |
|---|---|---|
| **A. Merchant's WhatsApp** | OTP + looks sent from the brand's own WhatsApp Business number | Phone, consents |
| **B. Shared AiVastra number** (not built in phase 2) | Same flow from the AiVastra number, branded per brand | Phone, consents |
| **C. QR download** | Shopper scans a QR and downloads the looks; no number asked | None |

- C is always offered, including when A or B is on and the shopper declines to share a number.
- **A needs per-merchant WhatsApp credentials.** Today the lane reads one number from env
  (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `apps/api/src/env.ts`). A adds an encrypted
  per-merchant channel row, Meta Embedded Signup (AiVastra as a Meta Tech Provider), per-number
  templates and webhook routing. B stays the env-configured number.
- Shoppers and consents captured under B **stay the merchant's** when it moves to A. Marketing sent
  from A must use the merchant's own approved templates.
- Mode changes are audited. Moving away from A or B never deletes already-captured customers.

### 4.1 Decisions for mode A (2026-11-12)

| # | Decision | Why |
|---|---|---|
| A1 | **Verify by tap-to-chat QR first; typed-number OTP later as a fallback.** The tablet shows a QR that opens WhatsApp to the brand's number with `LOOKS <code>` prefilled; the shopper sends it | WhatsApp itself proves the number, and the shopper's message opens the 24-hour service window, so looks go out as free-form messages: no per-merchant template approval and no per-OTP charge. Same pattern as the seller `CONNECT <code>` link (`messaging/identity.ts`). OTP needs approved authentication + utility templates on every merchant's account |
| A2 | **A merchant's number is connected by manual entry first** (WABA id, phone number id, permanent token, app secret, encrypted at rest). Embedded Signup later writes the same channel row | Embedded Signup needs AiVastra approved as a Meta Tech Provider, outside the code and weeks away |
| A3 | **Inbound routing by `metadata.phone_number_id`.** A message to a merchant channel goes to the shopper flow; anything else stays on the existing seller lane. The signature is checked with that channel's app secret | A merchant's own Meta app signs with its own secret |
| A4 | **Order:** Android test app moved to device pairing + sessions + event upload first (HLD step 4), then phase 2 server, then phase 2 tablet screens | The test app still uses owner login and `/v1/merchant/tryon/*`, so it has no session to end |

## 5. Shopper identification flow (default: at end)

1. Shopper tries on with no login. The session is anonymous (`shopper_id` null).
2. "Done", or the staff ending an assisted session, shows: *Get these looks on WhatsApp*, plus the
   QR code as the alternative.
3. Number entered → OTP sent (mode A/B number) → verified → consent screen (looks required,
   marketing optional) → upsert `shoppers` → the session and its events are linked to the shopper.
4. Looks delivered. The shopper page link (HLD §5.4) carries the wishlist and "Buy online".

The per-merchant `identify_at: 'end' | 'start'` setting moves step 3 before the first try-on.
The consent funnel (§7) is measured either way, so the merchant can see what the start option costs.

## 6. Cart and POS

### 6.1 Cart (fallback sales source)

A real cart per session, built by the shopper or the staff member on the tablet:

- **Add to cart** from any tried item. The shopper picks **size/variant** and quantity.
- **Checkout handoff** to the cashier, so billing uses the real SKUs (Q1):
  - item barcodes shown one by one on screen for the cashier's scanner (works with any POS, no integration), or
  - a cart code / QR the POS looks up through our API (needs the POS connector), or
  - a printed or WhatsApp'd cart slip.
- **A cart is not a sale.** A cart line becomes `sold` only when confirmed by the POS (§6.3) or by
  staff marking it billed. Unconfirmed carts expire with the session and count as abandoned.
- This replaces the bare "Sold" tap. Staff confirmation is still the fallback where no POS exists.

**Prerequisite, product variants.** `merchant_catalog_items` has one `sku` text field and prices, and
no size, colour or barcode. Billing happens per variant, so the cart needs a variant table per catalogue item:
`size`, `colour`, `sku`, `barcode (EAN/UPC)`, optional price override. That also enables the
colour, size and price-band analytics in §7. Catalogue import (CSV, or a sync from the merchant's
Shopify) becomes important for chains with thousands of variants.

### 6.2 Inventory: sizes and stock per branch (agreed 2026-11-12)

Today no stock or size data exists: an item is one `sku` and two prices. Stock lives at
**variant × branch**, because the same size can be in stock at one store and sold out at another.

**Sizes: standard lists plus free text**
- Standard size sets per garment type (e.g. tops S/M/L/XL/XXL, trousers 28–40, kids by age), curated
  by AiVastra admin and attached to garment types so they match the try-on taxonomy.
- A merchant may add a **free-text size** to any product (e.g. "Free size", "36B", a brand-specific
  fit). Stored with `is_custom = true`.
- Analytics group by standard size. Custom sizes show under their own label and can be mapped to a
  standard size by the merchant later, so free text never pollutes the standard reports.

**Stock: status by hand, exact counts from a feed (option C)**

| Column on `variant_branch_stock` | Notes |
|---|---|
| `variant_id, branch_id` | unique pair |
| `status` | `in_stock` \| `low` \| `out`, always set. What the kiosk reads |
| `quantity` | nullable. Set only by a feed. When present, `status` is derived from it and a per-merchant low threshold |
| `source` | `manual` \| `csv` \| `pos` \| `shopify` \| (extendable) |
| `updated_at, updated_by_staff_id` | staleness shown in the UI, e.g. "updated 3 days ago" |

- Manual updates are one tap per size ("L is out"), the only precision staff will realistically keep.
- A feed (POS/ERP, Shopify inventory per location) writes `quantity` and wins over manual entry for
  that branch. Manual edits there are blocked with a "managed by <source>" note, so two sources
  never fight.
- **Permissions:** the catalogue is brand-wide and staff-editable (HLD decision 7), but **staff may
  change stock only for their own branch.** Merchant admin, and AiVastra admin via the console, any branch.
  All changes audited.

**Where it is entered**
- `ProductModal`: a variants section (size from the standard list or free text, colour, SKU,
  barcode, optional price override), then availability per branch.
- `BulkUploadModal` / CSV import: `product, size, colour, sku, barcode, branch, status | quantity`.
  Needed for chains with thousands of variants.
- Later feeds: POS/ERP connector (§6.3), Shopify inventory per location.

**At the kiosk**
- Sizes are shown with this branch's availability. **Out-of-stock items stay visible and triable**
  (agreed), with **"Available at <other branch>"** (nearest branches that have the size in stock or low) and **"Buy
  online"** (merchant `store_url`).
- Both are events (`oos_viewed`, `other_branch_shown`, `buy_online_click`). Out-of-stock interest is
  a demand signal, not a dead end.
- Adding an out-of-stock size to the cart is blocked at this branch. "Reserve at another branch" is
  later, needs reliable stock, and stays out of v1 (HLD decision 11).

### 6.3 POS connectors

- Per-merchant connector: we push carts and receive bills, or poll the POS for bills.
- A bill is matched to a session by cart code, or by `(branch, time window, barcodes)` when the POS
  cannot carry our code.
- Matched bill lines mark cart lines `sold` with the **real billed price**, which replaces estimated revenue.
- Unmatched bills at a branch with AiVastra give the **store baseline**: conversion and basket
  size *with* vs *without* try-on. This is the number that proves AiVastra's impact (§7.9).
- Which POS systems first is decided by the first chain signed (Q2). The connector interface is
  generic, and each POS is an adapter.

## 7. Analytics

### 7.1 Event model

One append-only table, `analytics_events` (not partitioned yet, see D4 below):

| Column | Notes |
|---|---|
| `event` | e.g. `session_started`, `tryon_requested`, `tryon_completed`, `tryon_failed`, `item_viewed`, `wishlisted`, `cart_added`, `cart_removed`, `checkout_started`, `billed`, `identify_shown`, `otp_sent`, `otp_verified`, `consent_given`, `wa_sent`, `wa_delivered`, `wa_read`, `page_opened`, `buy_online_click`, `qr_scanned`, `session_ended` |
| dimensions | `merchant_id, branch_id, device_id, staff_id, session_id, shopper_id, catalog_item_id, variant_id, channel (kiosk / assisted / shopify / wordpress / whatsapp), mode (A/B/C)` |
| `props` jsonb | event-specific values: wait time ms, price, quantity, failure code |
| `occurred_at` | device time; `received_at` server time |

- Server events are written **in the same transaction** as their source write (session, sale,
  void, paid try-on charge), never instead of it. The source tables remain the truth for money and
  limits. Events are advisory, like `shopify_widget_events` (never read for credit, limit or
  authorization decisions). No foreign keys, so the insert cannot fail on data.
- **Try-on outcomes are derived, not emitted (phase 1 plan D1).** `tryon_completed` /
  `tryon_failed` and wait time come from `jobs` at rollup time, so the dispatcher's settlement
  transaction (the money path) carries no analytics write.
- Rollups are **15-minute UTC buckets** (`analytics_buckets`, D3), not daily: IST is UTC+5:30, so
  only a sub-hour bucket can serve local-hour charts. A 60s loop rebuilds touched buckets from a
  watermark; an hourly 48h safety pass corrects retried jobs and late commits.
- **The existing summary/timeseries/breakdown endpoints stay on source tables (D2).** Their
  definitions (counted by session start, voids excluded, credits net of refunds) are binding. A
  parity test (`analytics-parity.test.ts`) proves rollups agree; switching is a separate change.
- **No partitioning (D4)** until ~50M rows; 100 kiosks is ≈7M rows/year.
- Raw events serve drill-down and exports.
- Shopify widget events and attributed orders are mapped into the same dimensions, so the
  dashboard can show every channel together.

### 7.2 Metrics catalogue

★ = asked for explicitly. **New** = needs data not captured today.

**Footfall and engagement:** ★ sessions started · completed vs abandoned · kiosk vs assisted ·
session duration · items browsed per session · time to first try-on · peak-hours heatmap (hour ×
weekday per branch) · device utilisation (needs branch opening hours, **new**)

**Try-on:** ★ try-ons requested / completed · per session · failure rate · result wait time ·
most-tried items, categories, price bands · re-tries · try-on → wishlist

**Cart and conversion:** ★ try-ons converted to purchase · try-on → cart → billed funnel · cart
abandonment · per-item try-on → sale rate · assisted vs kiosk conversion · staff leaderboard ·
**lost demand** (tried often, rarely bought, broken down by size, colour, price)

**Inventory:** **out-of-stock demand** (tries and cart attempts on sizes out at that branch, per
item × size × branch, which tells the buying team what to reorder) · other-branch and buy-online
referrals from out-of-stock items · size curve of demand vs stock · stock staleness (branches whose
manual stock has not been updated in N days)

**Revenue:** estimated (cart × offer price) until POS, then real billed revenue · AOV · units
per bill · revenue per device / branch / staff

**Customers (CRM):** unique shoppers · new vs returning · visit frequency · visits to other branches of the same brand
· **consent funnel** (shown → number → OTP verified → looks → marketing) · customer profile
(visits, try-ons, purchases, preferences, last visit) · saved segments with export · RFM once billing is real

**WhatsApp and shopper page:** sent / delivered / read · page opens · downloads and shares ·
buy-online clicks · QR scans (mode C)

**Online channels:** Shopify widget opens, try-ons, add-to-cart, attributed orders and revenue
(`shopify_attributed_orders`, exists) · tried in store → bought online (consented phone match, **new**)

**Campaigns (later):** sent → delivered → read → clicked → redeemed → revenue (unique coupon per
campaign, **new**)

**Operations and cost:** devices online/offline, uptime, app version, errors · credits per
branch / device · cost per try-on · **cost per sale**

**Impact (needs POS):** conversion and basket size of try-on shoppers vs the store baseline ·
before/after kiosk install · branches with vs without kiosks

### 7.3 Product surface

- Date compare, filters on every dimension, drill-down HQ → branch → staff → device → session.
- Funnels and cohort retention (returning shoppers by first-visit month).
- CSV export, scheduled email reports to HQ, a read API for the chain's BI tools (Power BI, Tableau).
- Alerts: device offline, credits low, branch conversion drop, WhatsApp quality rating drop (mode A).
- Role scoping: merchant admin all branches; staff their branch and own numbers; customer data
  HQ-only (§3).

## 8. Phases

1. **Events foundation:** `analytics_events`, emission from existing session/job/try-on paths,
   tablet ingestion, 15-minute rollups, peak-hours heatmap, parity test (dashboard switch deferred,
   D2). Done 2026-11-12: `docs/superpowers/plans/2026-11-12-analytics-events-foundation.md`.
2. **Identification and consent:** at-end flow, OTP, two consents, encrypted `shoppers`, mode B + C.
3. **Variants, inventory and cart:** standard size sets, variant table, per-branch stock
   (manual status), CSV import, out-of-stock handling at the kiosk, cart on tablet, staff "billed"
   confirmation.
4. **CRM screens:** customer list, profiles, segments, export with permission + audit.
5. **Mode A:** per-merchant WhatsApp via Embedded Signup.
6. **POS connector** for the first chain, real revenue, impact metrics.
7. **Campaigns.**

Phases 1–4 are independent of a POS partner. The Android tablet app (HLD step 4) is needed for 2–3.

## 9. Build for POS and mobile from day one

**Agreed 2026-11-12:** POS integration and the mobile (Android tablet) integration are definite
features, but how they will be built is not decided. Everything built before them must support them
without rework or a breaking migration. Concretely:

**Sales source**
- A sale is a *confirmation* of a cart line with a `source` (`staff` now; `pos` later; open-ended
  for future sources such as an e-commerce order). Nothing may assume staff is the only source.
- Analytics read `billed` events, whatever confirmed them. Adding POS is then just a new source,
  with no metric rewrites.

**Cart**
- Every cart gets a stable, unguessable public `cart_code` from v1, even though v1's handoff is
  barcodes on screen. Later POS lookup by cart code then needs no migration.
- Cart lines reference `variant_id`. Variants carry `barcode` from v1, the key a POS bills on.

**POS connector seam**
- A per-merchant connector config row, with credentials encrypted like Shopify tokens, and a generic adapter
  interface: push cart, pull or receive bills, map POS line to variant. No POS-specific columns in core tables.
- Bill → session matching supports both cart code and `(branch, time window, barcodes)`.
- Billed price is stored per confirmation, so real revenue replaces estimated revenue line by line.

**Mobile (tablet) contract**
- Every tablet flow goes through the versioned `/v1/device/*` API with request/response shapes in
  `packages/types`. Rules live on the server. The app only renders, so web and tablet clients can never
  disagree on a rule.
- Device writes take an **idempotency key**. Store networks are flaky, and retries must not
  double-add cart lines or double-confirm sales.
- Events accept a client-generated event id and device `occurred_at`, so a tablet can buffer events
  offline and upload them later without duplicates.
- A device heartbeat (app version, last seen, connectivity) feeds the operations metrics and offline
  alerts. Do not rely only on `last_seen_at` being written as a side effect.

**Stock source**
- Stock, like sales, has a `source`. Manual status now; a POS/ERP or Shopify feed later writes exact
  `quantity` and takes over that branch with no schema change (§6.2).

**Channels**
- `channel` and `mode` are extendable values, not hard-coded logic, so a new integration (POS,
  a future app, WordPress in store) adds a value, not a schema rewrite.

## 10. Open questions

- **Q1** Checkout handoff for v1: barcodes on screen (any POS), cart slip, or wait for POS lookup?
  *Deferred 2026-11-12 with POS. §9 keeps every option open.*
- **Q2** Which POS do target chains use (e.g. Ginesys, Logic ERP, SAP Retail, Shopify POS)? Decides
  the first connector. *Deferred. The adapter seam (§9) is built regardless.*
- **Q3** Does the shopper or only staff add to cart in kiosk mode? Kiosk carts without staff may be
  abandoned at a higher rate.
- **Q4** ~~Retention defaults~~ *Answered 2026-11-12: no default. The merchant must choose a retention period for shopper photos and profiles before identification can be switched on.*
- **Q5** ~~Who pays in mode B~~ *Moot 2026-11-12: mode A is primary, so messages are billed by Meta to the merchant's own WhatsApp Business account.*
- **Q6** Is the DPA (data processing agreement) template a legal task already owned by someone?

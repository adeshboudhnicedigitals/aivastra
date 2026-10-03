# WordPress.org Publish Progress — Ai Vastra Try-On

Living tracker for `PUBLISH-PLAN.md`'s steps. The checklist below reflects
**current status** and gets checked off / updated in place as work happens.
The dated log underneath is append-only — newest entry on top — for context
on *why* something changed, same convention as the main repo's
`docs/progress.md`.

**Last updated:** 2026-10-02

## Status checklist

- [~] **1. Terms/Privacy finalized** — PARTIAL. Draft banners removed; both
      pages are now grounded in Ai Vastra's own published policies
      (aivastra.com/terms, aivastra.com/privacy-policy) instead of
      placeholder text. Still genuinely open, pending a real legal pass:
      governing-law jurisdiction/city, a named Grievance Officer, a
      deletion-request turnaround time, and credit-expiry policy — none of
      which the live aivastra.com policies resolve either.
- [ ] **2. wordpress.org account created**
- [ ] **3. `readme.txt` Contributors field filled** — blocked on #2
- [ ] **4. Submission assets produced** (3 screenshots, icon, banner)
- [x] **5. AJAX handlers self-audited** (nonce + capability checks) — DONE,
      see log. Also ran a full 18-point detailed-plugin-guidelines audit;
      one real gap found and fixed (readme didn't disclose widget-event
      telemetry).
- [ ] **6. wp.org zip built** (`make wordpress-plugin-zip`)
- [ ] **7. Submitted to wp.org for review**
- [ ] **8. Reviewer feedback resolved**
- [ ] **9. SVN checked out, trunk/assets populated**
- [ ] **10. First release committed to SVN**
- [ ] **11. Listing confirmed live** at wordpress.org/plugins/aivastra-tryon/

## Current blocker

**Step 1 — four specific legal items**, not a full rewrite anymore: a named
Grievance Officer, governing-law jurisdiction/city, a deletion-request
turnaround time, and credit-expiry policy. Everything else about Terms/
Privacy is now grounded in Ai Vastra's real published policies. Steps 2–6
have no dependency on these four items and can proceed in parallel; actual
submission (step 7) still waits on them being resolved, since `readme.txt`
shouldn't reference pages with open legal brackets.

## Dated log

### 2026-10-02 (later) — Embedded email/password connect: no redirect for the common case

User pushed further than the redirect-based "Log in with Ai Vastra" flow
below: "it is going to app.aivastra again right can't we skip this?? ... it
should be like Shopify." Shopify can skip a login prompt entirely because it
*is* the identity provider — WordPress has no equivalent trusted assertion
about the admin's aivastra identity, so some credential still has to be typed
at least once. What's fully achievable instead: once that credential is given,
everything — login-or-register, merchant creation, key minting — happens
server-to-server in one AJAX call, no browser redirect anywhere, for the
common case (a returning, already-verified account, which is also every
*second* site a business connects).

**Shipped:**
- Backend: new public, rate-limited (5/min) `POST /v1/merchant/wordpress-login`
  (`apps/api/src/modules/merchant/wordpress-login.routes.ts`) — finds the
  account by email; not found + phone given → registers it exactly like
  `/v1/auth/register` (same complexity check, applied explicitly since the
  shared request schema can't force it onto a login attempt too) and sends the
  same verification email, `202 {status:'verification_required'}`; found →
  password/ban check, email-verified check (resends on demand), then
  `ensureMerchantForUser()` + key mint → `200 {status:'connected', ...}`.
  Shares `mintWordpressKeyPair()`/`ensureMerchantForUser()`
  (`wordpress-shared.ts`) with the existing connect route, which switched its
  `preHandler` from `requireMerchant` to `requireUser` so a brand-new Google
  signup can self-serve a merchant row inline instead of 403ing first. New
  migration `0209` adds `'wordpress'` to `merchants.signup_source`'s CHECK
  constraint. 10 new API integration tests + 6 pre-existing wordpress-connect
  tests, all passing; full API suite 704/704, no regressions.
- Frontend: `connect/wordpress/page.tsx`'s merchant-gate message split in two
  — "inactive" (contact support, unchanged) vs. "no merchant row yet" (inline
  phone field posting to the now phone-accepting
  `POST /v1/merchant/wordpress-connect`). New `isMerchantMissingError` helper
  in `src/lib/api.ts` distinguishes the two by message text. Typecheck clean.
- Plugin: new primary embedded form (`admin/assets/connect.js` →
  `Aivastra_Connect_Ajax` → `Aivastra_Connection_Service::login_or_register()`)
  replaces the old single "Log in with Ai Vastra" button, which becomes
  "Continue with Google" underneath it — same `admin_post_..._start` handler,
  now redirecting to `/v1/auth/google/init?next=<consent path>` instead of the
  consent page directly, so Google's own login screen shows first instead of
  Ai Vastra's branded `/login` form. Google's fixed, registered
  `GOOGLE_CALLBACK_URL` means this one path keeps a single hop through
  `app.aivastra.com` — there's no way around that specific constraint.
  "Advanced: connect with API keys instead" is untouched. `docs/wordpress-plugin-design.md`
  §4.1 updated with a dated addendum, old content kept for history.

**Tests:** 6 new `login_or_register()` cases in `ConnectionServiceTest.php`
(connects, registers, wrong password, unverified, phone required, network
error) — full suite 87/87 pass (81 pre-existing + 6 new).

**Not yet done:** the end-to-end manual click-through on `local-wp` (embedded
form connects with no redirect; "Continue with Google" lands on the consent
page, not a login form; brand-new email → verify → reconnect succeeds;
"Advanced" paste-key path still works).

### 2026-10-02 — "Log in with Ai Vastra" replaces manual key paste as the primary connect flow

User asked to remove the account-creation detour: instead of requiring the
admin to leave wp-admin, create/find an app.aivastra.com account, generate two
`sk_live_…` keys, and paste them in, the admin now clicks a **"Log in with Ai
Vastra"** button, logs in or signs up right there, and both keys are minted
and linked automatically. A reversed-OAuth flow (WordPress is the "client,"
app.aivastra.com is the "authorization server"), built on two already-shipped
mechanisms: the Google-login state+redirect+one-time-Redis-code shape and the
existing full+widget key-minting route (still exclusively gated behind the
merchant's session JWT — a leaked key still can never mint another).

**The original paste-key form is kept**, unchanged, behind a collapsed
"Advanced: connect with API keys instead" disclosure — explicit product
decision, not a removal. `docs/wordpress-plugin-design.md` §4.1 is updated to
record this, with the original v1 design kept inline for history rather than
deleted (it correctly reflected the tradeoff at the time; the tradeoff changed
once the OAuth surface was being built regardless of which flow was primary).

**Shipped:**
- Backend: `POST /v1/merchant/wordpress-connect` (mints both keys, stores a
  60s one-time code in Redis) + `POST /v1/wordpress/connect/exchange` (public,
  rate-limited, redeems the code once) —
  `apps/api/src/modules/merchant/wordpress-connect.routes.ts`. 6 new
  integration tests, all passing; no regression in the existing 688-test API
  suite.
- Frontend: new consent screen `apps/catalogues-web/src/app/connect/wordpress/page.tsx`,
  reusing the existing `next=`-redirect login/register flow (threaded through
  `/register` → `/verify-email` → back to `/login`, via a `sessionStorage`
  `pending_next` handoff, so a genuinely new signup doesn't lose the "no
  separate account-creation detour" promise) and the existing merchant-gate
  messaging from `KeysPanel.tsx` (now shared via `isMerchantGateError` in
  `src/lib/api.ts`). Typecheck + lint clean.
- Plugin: `handle_connect_start()`/`handle_connect_callback()`
  (`admin/class-settings-page.php`) and
  `Aivastra_Connection_Service::exchange_connect_code()`
  (`includes/class-connection-service.php`). CSRF on the cross-site callback
  is a `state` transient match (no WP nonce possible — the redirect originates
  from app.aivastra.com, not a same-site form). `render_connect_form()`
  rewritten: new primary button, old form moved under `<details>`, completely
  unchanged otherwise (same fields/nonce/action as before).

**Tests:** `ConnectionServiceTest.php` extended with 4 new cases for
`exchange_connect_code()` (success, network error, non-200, malformed body) —
mirrors the existing `connect()` test style exactly. Full suite: 81/81 pass (77
pre-existing + 4 new). `handle_connect_start()`/`handle_connect_callback()`
themselves are **not** unit-tested — consistent with every other `admin_post`
handler in this file (`handle_connect`, `handle_disconnect`,
`handle_save_category_map`, `handle_skip_onboarding`, `handle_buy`,
`handle_save_widget_customization`): all of them call `exit`, none of them
have unit tests under this suite's plain-PHPUnit setup, and this codebase's
existing convention is to verify that class of method via the manual/e2e
click-through instead. Covered by the end-to-end verification step below.

**Not yet done:** the end-to-end manual click-through on `local-wp` (start →
login/register → consent → callback → dashboard shows "connected"), and a
separate manual check that the kept "Advanced" paste-key path still works
unchanged.

### 2026-10-02 — Full detailed-plugin-guidelines audit (step 5) + one gap fixed

User pointed at wp.org's `detailed-plugin-guidelines` page. Fetched its full
18-point text and checked the actual shipped code (not the readme's claims)
against each one. Full results below — see the chat response for the
point-by-point table.

**One real, code-grounded gap found:** `assets/widget.js` fires an anonymous
`sendWidgetEvent()` call (button shown/clicked, upload started, result
viewed, added to cart, shared) to `POST /v1/dev/widget-event` — this powers
the already-disclosed "per-product try-on analytics" dashboard feature, but
`readme.txt`'s Third Party Services section never named this specific data
flow, only the image-upload and billing calls. Guideline 7 requires
documented external data use. Fixed: added one paragraph to the Ai Vastra
bullet in `readme.txt` naming exactly what's sent and confirming it's
interaction-triggered only (nothing fires on page load).

**Everything else passed on direct inspection:**
- No minified/obfuscated code anywhere in the shipped tree (checked max
  line length per file).
- No separately-bundled jQuery — `widget.js` reuses WooCommerce's own
  already-loaded `window.jQuery`, defensively guarded, not re-enqueued.
- Razorpay's `checkout.js` is the only remote-hosted script, loaded only on
  the plugin's own settings page and only during an active checkout
  (gated behind a real pending-order transient) — not sitewide.
- All four AJAX handlers (`class-cart-ajax.php`, `class-checkout-ajax.php`,
  `class-refresh-ajax.php`, `class-support-ajax.php`) have a
  `check_ajax_referer` nonce check; the three admin-only ones also gate on
  `current_user_can('manage_woocommerce')`. `cart-ajax.php` intentionally
  has no capability check and registers both `wp_ajax_` and
  `wp_ajax_nopriv_` — correct, since it's the shopper-facing add-to-cart
  action, not an admin action.
- Zero `admin_notices` hooks anywhere — no dashboard-wide nagging risk.
- No forced "Powered by"/credit branding in `widget.js`/`widget.css`.
- `readme.txt` has exactly 5 tags (wp.org's own cap), no affiliate links.
- wp.org zip variant (`make wordpress-plugin-zip`) ships zero third-party
  vendored code once `class-update-checker.php` + `includes/vendor/` are
  stripped, so GPL-compatibility of bundled code is a non-issue for that
  variant.
- Plugin slug `aivastra-tryon` is original branding, no trademark conflict.
- Version consistent (`0.5.13`) between `aivastra-tryon.php` and
  `readme.txt`'s `Stable tag`.

**Not auditable yet (process-stage guidelines, apply once actually
submitting):** stable-version-via-directory, avoid frequent SVN commits,
increment version per release, complete plugin at time of submission.

## Dated log

### 2026-10-01 (later) — Terms/Privacy grounded in Ai Vastra's real published policies

User supplied the live aivastra.com Terms (`/terms/`) and Privacy Policy
(`/privacy-policy/`) pages. Fetched both verbatim (raw HTML → stripped text,
not an AI-summarized paraphrase, since this is going into an actual legal
document) and found:

- **Privacy Policy** is already written platform-agnostically ("regardless
  of the platform, device, integration, or method") — covers websites,
  applications, plugins, and APIs by its own wording, so no scope conflict
  with reusing it for the WordPress plugin / direct web app / developer API.
  Rewrote `apps/catalogues-web/src/app/privacy/page.tsx` grounded in this
  real text (verbatim/near-verbatim per section), resolving the entity-name
  bracket (company's own live policy just says "AI Vastra", no separate
  registered suffix), the AI-training statement (now sourced, not asserted),
  and part of the international-transfer section. Confirmed live at
  `app.aivastra.com/privacy` returns 200 with the draft banner gone.
- **Terms of Service** — found a real scope problem: the live page's own
  text is "These Terms of Service ("Terms") govern your use of the **AI
  Vastra Shopify application** ("App")" — explicitly Shopify-only, never
  mentions the WordPress plugin, direct web app, API, or Razorpay credit
  purchases. Flagged this to the user before touching anything (did not
  silently decide). User chose: generalize the live text's scope (replace
  the Shopify-only "App" framing with "the Services" covering all
  integrations) while keeping its actual legal language — not leave it
  Shopify-only, not just link out to the Shopify-scoped page unchanged.
  Rewrote `apps/catalogues-web/src/app/terms/page.tsx` accordingly, merging
  the live framework (services, eligibility, IP, liability cap, termination
  — carried over near-verbatim) with the already-good product-specific
  sections the prior draft had (credits/GST billing, acceptable use,
  AI-accuracy disclaimer) rather than discarding that work. The page's own
  intro paragraph now discloses exactly what was carried over vs.
  broadened, so a future legal reviewer isn't misled about provenance.
- Two items confirmed **genuinely unresolved even in AI Vastra's own live,
  published Terms/Privacy** (not something introduced by this draft):
  governing-law jurisdiction/city, and credit-expiry policy. Two more are
  privacy-specific and still open: a named Grievance Officer (India IT
  Rules), and an explicit deletion-request turnaround time.
- Updated `wordpress-plugin/readme.txt`'s Third Party Services note to
  reflect this — no longer "both pages are drafts," now specifically lists
  the four remaining open items.
- Verified live: `tsc --noEmit` clean, `biome check` clean (one
  line-wrapping auto-fix via `--write`), both pages return 200 locally with
  the draft banners gone and the still-open brackets visible (not silently
  dropped).

**Next action:** get the four remaining open items answered (governing-law
city, Grievance Officer name, deletion turnaround, credit-expiry policy) —
likely a single short legal/business decision pass rather than a full
rewrite. Steps 2 (wp.org account), 5 (AJAX audit), and 6 (zip build) remain
open and still have no dependency on this.

### 2026-10-01 — Plan + tracker created

Created `PUBLISH-PLAN.md` and this file. No new engineering work yet — this
session audited the existing repo state and confirmed:

- `readme.txt` (`wordpress-plugin/readme.txt`) is fully wp.org-formatted
  already, with two unresolved TODOs: `Contributors: TODO_WPORG_USERNAME`
  and the Third Party Services section pointing at draft Terms/Privacy URLs.
- `apps/catalogues-web/src/app/terms/page.tsx` and `.../privacy/page.tsx`
  are deployed and return 200, but both open with
  `[DRAFT — NOT YET PUBLISHED]` and carry multiple `[LEGAL TO CONFIRM]`
  markers (jurisdiction, credit-expiry policy, Grievance Officer, hosting
  region, entity name).
- No screenshots, icon, or banner assets exist anywhere in the repo for the
  wp.org `/assets` SVN folder.
- No wordpress.org account exists yet (no `Contributors` username available
  to fill in).
- `scripts/wordpress-plugin/build-zip.sh` (`make wordpress-plugin-zip`)
  already produces a correct wp.org-clean zip, stripping
  `includes/class-update-checker.php` and `includes/vendor/` — verified
  against the script's own source and the 2026-09-09 `docs/progress.md`
  entry that built and inspected both zip variants.
- AJAX handlers (`class-cart-ajax.php`, `class-checkout-ajax.php`,
  `class-refresh-ajax.php`, `class-support-ajax.php`) have not yet been
  specifically re-audited for nonce/capability checks ahead of a wp.org
  submission — flagged as step 5, not yet done.

**Next action:** legal review of Terms/Privacy (step 1, owner: business) —
everything else downstream of step 7 (actual submission) waits on it. Steps
3/5/6 can start immediately in parallel.

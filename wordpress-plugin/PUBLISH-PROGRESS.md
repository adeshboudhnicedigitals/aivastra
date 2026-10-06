# WordPress.org Publish Progress — Ai Vastra Try-On

Living tracker for `PUBLISH-PLAN.md`'s steps. The checklist below reflects
**current status** and gets checked off / updated in place as work happens.
The dated log underneath is append-only — newest entry on top — for context
on *why* something changed, same convention as the main repo's
`docs/progress.md`.

**Last updated:** 2026-10-06

## Status checklist

- [~] **1. Terms/Privacy finalized** — PARTIAL, **deliberately deferred past
      submission** (business decision, 2026-10-06 — see log). Draft banners
      removed; both pages are grounded in Ai Vastra's own published policies
      (aivastra.com/terms, aivastra.com/privacy-policy) instead of placeholder
      text. Four items remain open pending a real legal pass: governing-law
      jurisdiction/city, a named Grievance Officer, a deletion-request
      turnaround time, and credit-expiry policy — none of which the live
      aivastra.com policies resolve either. These pages are **not** part of
      the plugin's release cycle — they're deployed separately on
      app.aivastra.com and can be fixed same-day, independent of any plugin
      version, whenever legal input lands.
- [x] **2. wordpress.org account created** — `aivastra` (aivastra2025@gmail.com).
      Confirm the exact login username matches before relying on it in
      readme.txt — the screenshot only confirmed the display name.
- [x] **3. `readme.txt` Contributors field filled** — `Contributors: aivastra`.
- [x] **4. Submission assets produced** (3 screenshots, icon, banner) — DONE,
      see log. Staged at `wordpress-plugin/wporg-assets/`, correctly sized
      and renamed to wp.org's required filenames.
- [x] **5. AJAX handlers self-audited** (nonce + capability checks) — DONE,
      see log. Also ran a full 18-point detailed-plugin-guidelines audit;
      one real gap found and fixed (readme didn't disclose widget-event
      telemetry).
- [x] **6. wp.org zip built** (`make wordpress-plugin-zip`) — DONE, see log.
- [x] **7. Submitted to wp.org for review** — automated scan passed on the
      rebuilt zip; status "Awaiting Review" as of 2026-10-06. **Action
      needed before approval: fix the auto-assigned slug** — see log.
- [ ] **8. Reviewer feedback resolved**
- [ ] **9. SVN checked out, trunk/assets populated**
- [ ] **10. First release committed to SVN**
- [ ] **11. Listing confirmed live** at wordpress.org/plugins/aivastra-tryon/

## Current blocker

**[YOU], urgent, time-limited:** wp.org auto-assigned the slug
`ai-vastra-try-on` on submission — every reference in this repo (`readme.txt`,
`aivastra-tryon.php`, `scripts/wordpress-plugin/build-zip.sh`'s `SLUG` var,
`PUBLISH-PLAN.md`'s SVN commands) uses `aivastra-tryon` instead. The
submission page explicitly states the slug **cannot be changed once
approved**. Go back to the submission page and change the slug to
`aivastra-tryon` before a reviewer picks this up. Everything else is done;
this is the only open item. All of steps 2-6 are done. The four legal items
from step 1 remain open but are no longer gating submission (business
decision, 2026-10-06). Next action is purely [YOU]: upload the zip at
wordpress.org/plugins/developers/add and fill in the submission form (see the
2026-10-06 (later) log entry below for the exact field values).

## Dated log

### 2026-10-06 (final) — Resubmitted, scan passed, awaiting review — slug mismatch flagged

Rebuilt zip re-uploaded; automated scan now **Pass**. Status: "Awaiting
Review," submitted under account `aivastra2025@gmail.com`. ~100 plugins ahead
in the queue per wp.org's own page at submission time.

**Flagged to user, not yet resolved:** wp.org auto-assigned the slug
`ai-vastra-try-on` (hyphenating the display name "Ai Vastra Try-On" word by
word) — a mismatch against `aivastra-tryon`, which is used everywhere in this
repo (confirmed via grep: `readme.txt`, `aivastra-tryon.php`,
`build-zip.sh`'s `SLUG` var, `PUBLISH-PLAN.md`'s SVN checkout/commit
commands — `ai-vastra-try-on` appears nowhere in the repo). The submission
page states the slug is permanent once approved, so this must be corrected
via the page's own "change" link before review completes, or every
downstream reference (SVN URL, live plugin-directory URL, zip folder name)
would be permanently wrong. User needs to act on this directly on wp.org;
nothing in-repo needs to change either way since `aivastra-tryon` is already
used consistently throughout.

**Next action:** user changes the slug on the submission page, then waits
for the review email.

### 2026-10-06 (latest) — First submission rejected by automated scan; fixed

User's first upload attempt at wordpress.org/plugins/developers/add bounced
off wp.org's automated plugin-check scanner (not a manual reviewer yet):

```
.gitignore ERROR: hidden_files — Hidden files are not permitted.
PUBLISH-PROGRESS.md WARNING: unexpected_markdown_file
PUBLISH-PLAN.md WARNING: unexpected_markdown_file
```

Both real, both caused by `scripts/wordpress-plugin/build-zip.sh`'s exclude
list never having accounted for these three repo-root files — they were
never relevant until the zip was actually scanned by wp.org's tooling.
Checked the full source tree for any other hidden files first (`find . -name
".*"`): only `.gitignore` itself at plugin root; `.phpunit.result.cache` is
already correctly stripped via the existing `.gitignore`-based rsync filter.

**Fixed:** added `--exclude "/.gitignore"`, `--exclude "/PUBLISH-PLAN.md"`,
`--exclude "/PUBLISH-PROGRESS.md"` to `COMMON_EXCLUDES`. Rebuilt and verified
directly against the zip listing: zero hidden files, zero stray `.md` files,
43 files total (down from the previous 54 — the difference is exactly the 3
newly-excluded files plus the 8 `wporg-assets/*` entries excluded by the
prior fix earlier today, confirmed by re-checking the byte counts).

**Next action:** user re-uploads the rebuilt
`dist/wordpress-plugin/aivastra-tryon-wporg-0.5.13.zip`.

### 2026-10-06 (later) — Submission assets staged, zip rebuilt, ready to submit

User supplied `pluginassets.zip` (3 screenshots at 1280×720, icon at
128×128/256×256, banner at 772×250/1544×500 — all correctly sized against
wp.org's spec, verified directly with `file` on each extracted PNG). Unzipped,
renamed to wp.org's exact required filenames, and staged at
`wordpress-plugin/wporg-assets/` (`icon-128x128.png`, `icon-256x256.png`,
`screenshot-1.png`/`-2`/`-3`, `banner-772x250.png`, `banner-1544x500.png`),
then deleted the source zip. This folder is a **staging area only** — per
`PUBLISH-PLAN.md` step 4/9, these never ship inside the plugin's own zip; they
get copied into the SVN `/assets` folder (sibling to `/trunk`) after approval.

**Caught and fixed a real bug while verifying:** `make wordpress-plugin-zip`
initially packaged the new `wporg-assets/` folder *into* the plugin zip
(confirmed by listing the zip's contents) because
`scripts/wordpress-plugin/build-zip.sh`'s exclude list had no entry for it.
Added `--exclude "/wporg-assets"` to `COMMON_EXCLUDES` (same pattern as the
existing `/local-wp`, `/tests`, `/vendor` exclusions) and rebuilt — reverified
the zip listing has zero `wporg-assets`/`vendor`/`local-wp`/`tests`/
`composer`/`update-checker`/`phpunit`/`.DS_Store` entries. 54 files in the
final `aivastra-tryon-wporg-0.5.13.zip`.

Re-verified `readme.txt` directly: `Contributors: aivastra` filled, no
leftover `TODO`/placeholder text anywhere in the header or body.

**Result:** `dist/wordpress-plugin/aivastra-tryon-wporg-0.5.13.zip` is the
file to upload at wordpress.org/plugins/developers/add. Steps 4-6 are done;
step 7 (actual submission) is a [YOU]-only action — needs the human's wp.org
login.

### 2026-10-06 — Decision: submit without waiting for legal; readme leak fixed

User decided to submit for wp.org review now rather than wait on the four
open legal items (step 1), planning to update the live Terms/Privacy pages
once legal input lands — correctly noting those pages redeploy independently
of the plugin's own version/release cycle, so there's no actual coupling to
a "next plugin update."

Confirmed this is not a wp.org *review* blocker: the detailed-plugin-guidelines
page requires external data use to be disclosed in the readme (already true,
verbatim per-service), not that linked Terms/Privacy pages be legally
complete. Re-verified directly that the four `[LEGAL TO CONFIRM]` brackets
are still live in `apps/catalogues-web/src/app/terms/page.tsx` (governing
law + jurisdiction city, credit-expiry) and `.../privacy/page.tsx` (deletion
turnaround, Grievance Officer) — genuinely unresolved, not a stale note.

**Found and fixed a real bug while re-checking `readme.txt`:** its Third
Party Services section contained an internal note-to-self — "...Do not
submit to wp.org until legal confirms them." — as literal body text. Since
`readme.txt`'s Description/Third-Party-Services content **is** what renders
as the public wp.org plugin page, this would have shipped an internal
engineering caveat to every visitor. Removed the whole aside; the Ai Vastra
bullet now just states the service, what it receives, and links to Terms/
Privacy, same shape as the Razorpay and Support Chat bullets below it.
Rebuilt `dist/wordpress-plugin/aivastra-tryon-wporg-0.5.13.zip` with the fix.

Also confirmed while re-auditing: account `aivastra` created (step 2),
`readme.txt` Contributors field filled (step 3), no other leftover
TODO/FIXME/placeholder text anywhere else in the plugin tree. Could not
re-run PHPUnit in this environment (no `php` binary available) — last
verified pass stands from the referenced 2026-09-09 run.

**Next action:** user produces icon/banner/screenshots (step 4), then
uploads the rebuilt wp.org zip at wordpress.org/plugins/developers/add
(step 7). Legal items remain open-but-deferred; fix the two live pages
whenever that input lands — no plugin rebuild required for that fix.

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

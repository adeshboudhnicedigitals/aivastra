# WordPress.org Publish Plan — Ai Vastra Try-On

Static reference for getting `aivastra-tryon` listed on the WordPress.org
plugin directory. This file describes the **process** and doesn't change
unless the process itself changes. For live status — what's done, what's
blocked, dated log entries — see `PUBLISH-PROGRESS.md` in this same folder.

Each step is tagged with who it needs:
- **[YOU]** — needs the business/a human (legal sign-off, an account only you
  can create, design assets).
- **[ME]** — an engineering task that can be done inside this repo by an
  agentic coding session.
- **[YOU + ME]** — needs both, in sequence.

---

## 1. [YOU] Finalize Terms of Service & Privacy Policy

**Blocking everything else.** `apps/catalogues-web/src/app/terms/page.tsx`
and `.../privacy/page.tsx` are live (200 OK at `app.aivastra.com/terms` /
`/privacy`) but still carry a `[DRAFT — NOT YET PUBLISHED]` banner and several
`[LEGAL TO CONFIRM]` brackets:
- Governing-law jurisdiction / city
- Credit-expiry policy
- India IT-Rules-required Grievance Officer name/address
- Hosting-region / international-transfer disclosure
- The operating legal entity's exact name (currently inferred, not confirmed)

Get a lawyer (or at minimum the business owner) to resolve every bracket,
then have the draft banners removed and the pages redeployed.
`wordpress-plugin/readme.txt`'s Third Party Services section explicitly says
not to submit to wp.org referencing these URLs until this is done.

## 2. [YOU] Register a wordpress.org account

https://wordpress.org/support/register.php — this becomes your
`Contributors:` username and, later, your SVN login.

## 3. [ME] Fill in `readme.txt`'s `Contributors:` field

Currently `TODO_WPORG_USERNAME` at `wordpress-plugin/readme.txt:2`. One-line
edit once step 2's username exists.

## 4. [YOU, assisted] Produce submission assets

None of these exist in the repo yet:
- 3 screenshots (`screenshot-1.png` / `-2` / `-3`) matching the descriptions
  already written in `readme.txt`'s `== Screenshots ==` section (try-on
  button, result modal, settings screen). Can be scripted via Playwright
  against the local-wp demo store.
- Plugin icon: `icon-128x128.png` + `icon-256x256.png`.
- Banner (optional but standard): `banner-772x250.png` + `banner-1544x500.png`.

These don't ship in the plugin zip — they go in the SVN `/assets` folder
(step 9), sibling to `/trunk`.

## 5. [ME] Self-audit the AJAX handlers

Before submission, confirm every handler has a nonce check and a capability
check — the single most common wp.org review rejection reason for a plugin
with AJAX endpoints:
- `wordpress-plugin/includes/class-cart-ajax.php`
- `wordpress-plugin/includes/class-checkout-ajax.php`
- `wordpress-plugin/includes/class-refresh-ajax.php`
- `wordpress-plugin/includes/class-support-ajax.php`

## 6. [ME] Build the submission zip

```bash
make wordpress-plugin-zip
# → dist/wordpress-plugin/aivastra-tryon-wporg-<version>.zip
```

This is the **wp.org variant** — `scripts/wordpress-plugin/build-zip.sh`
already strips `includes/class-update-checker.php` and `includes/vendor/`
from it, since a wp.org-listed plugin can't carry its own update mechanism
(WordPress core takes over updates via SVN's `Stable tag`).

## 7. [YOU] Submit for review

https://wordpress.org/plugins/developers/add/ — upload the `-wporg-` zip
from step 6. Typical wait: a few days to a few weeks (real backlog).

## 8. [YOU + ME] Respond to reviewer feedback

Expect at least one round. Common asks for a plugin like this (external API +
payment integration): tighter justification for every external call (your
Third Party Services disclosure already covers this), nonce/capability
checks (step 5 pre-empts this), confirming Razorpay checkout never touches
card data server-side (already true, already stated in the readme).

I can make any requested code changes; you respond to the actual review
thread from your wp.org account.

## 9. [YOU] Once approved — set up SVN

```bash
svn co https://plugins.svn.wordpress.org/aivastra-tryon/ /tmp/aivastra-tryon-svn
```

Copy the **unzipped** contents of the wp.org build zip into `trunk/`, and the
screenshots/icon/banner from step 4 into `assets/` (sibling to `trunk/`, not
inside it).

## 10. [YOU] First release commit

```bash
cd /tmp/aivastra-tryon-svn
svn add trunk/* assets/* --force
svn cp trunk tags/<version>   # match readme.txt's Stable tag
svn ci -m "Release <version>"
```

Live at `https://wordpress.org/plugins/aivastra-tryon/` within the hour.

## 11. [ME] Every future release

Bump `Version:` in `aivastra-tryon.php` and `Stable tag:` in `readme.txt`
together (they must match) → rebuild the zip (step 6) → you copy into
`trunk/` + `svn cp trunk tags/<new-version>` + `svn ci`. wp.org sites
auto-update off the `tags/` + `Stable tag` combination — no action needed
from installed sites.

---

## What's already done (don't redo)

- `readme.txt` fully wp.org-formatted (headers, Description, Installation,
  FAQ, Third Party Services disclosure, Changelog).
- GPLv2-or-later license declared correctly in both the plugin header and
  readme.
- `scripts/wordpress-plugin/build-zip.sh` / `make wordpress-plugin-zip`
  already builds both the wp.org-clean zip and the direct-share zip from one
  source tree.
- Full WordPress PHPUnit suite passing (67 tests / 101 assertions as of the
  last run referenced in `docs/progress.md`'s 2026-09-09 entry).

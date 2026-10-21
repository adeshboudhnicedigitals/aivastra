# Handoff — WhatsApp pose cards + early classification (2026-10-21)

Session on `dev` after pulling `origin/dev` (fast-forward `f5c8e79e` → `6bdd81dd`). Two changes
were made, **uncommitted, in the working tree**. Nothing is pushed.

> **Moving machines:** uncommitted work does not travel. Commit to a feature branch and push
> (or `git diff > wa.patch` and carry the file) before switching. Nothing was committed here —
> that is the owner's call (CLAUDE.md: commit only complete units).

## 1. Pose carousel: label removed (done, one unverified risk)

Ask: pose list images are landscape → show portrait; drop the pose label/slug.

**Done**
- `engine/types.ts`: `cards` messages no longer carry `title`.
- `engine/engine.ts` (`cardsMsgs`): stops passing `title: i.label`.
- `channels/whatsapp/render.ts`: carousel cards have **no `body`**; the single-card message is
  just `m.text` (the `${title}\n\n` prefix is gone); `CARD_BODY_MAX` deleted.
- Tests: `whatsapp-render.test.ts` updated; `messaging-engine.test.ts` now identifies cards by
  `imageUrl` (`https://img/<id>.jpg`) instead of title.

**Unverified — test on a real WhatsApp number first**
- Whether Meta accepts a carousel card with **no body**. If it 400s ("missing body", like the
  missing card `type` noted at `render.ts` ~line 90), put back a minimal non-empty body (e.g. a
  zero-width space). One-line fix in `render.ts`.

**Not done — portrait**
- The landscape look is almost certainly Meta cropping carousel cards to one fixed ratio; our
  code only supplies a presigned thumbnail URL (`models/queries.ts:264`). Not confirmed: a docs
  lookup was denied by the permission classifier. Options discussed:
  - Re-crop thumbnails to the ratio Meta wants (try first, cheapest): see exactly how Meta crops
    the current thumbnails, then decide.
  - Contact-sheet: one portrait image with the 10 poses in a numbered grid + a list/buttons to
    pick. Full control of ratio, needs image compositing (check if `sharp` is already a dep).
  - **Rejected by the user:** one message per pose (100+ poses, 10 per page — too noisy).

## 2. Classification moved to right after the image upload (Option C, done)

**Why this shape.** Garment types are per-gender rows (`garment_subcategories.genderSlug`), a
photo carries no gender, so classifying before the gender question over all genders' types gives
an ambiguous "Shirt" (men's vs women's row). Decided (CLAUDE.md-style tradeoff, options A/B/C):
**C** = one option per label across genders, start the request at upload, collect it after the
gender tap (the wait overlaps the seller answering the gender question).

**Implementation** (`apps/api/src/modules/messaging/`)
- `classify.ts`: `recognizeGarment` is replaced by
  - `startRecognition(app, garmentKey, opts?)` → `RecognitionTicket | null` (only queues the
    request; candidates = `kindCandidates`, deduped by normalised label across women/men/boys/girls),
  - `resolveRecognition(app, ticket, gender)` → `{garmentTypeId,label} | null` (waits the
    remaining budget, `matchAnswer` over kinds, then maps to the tapped gender's row by label).
  - `waitForResult` now checks Redis once even with no budget left.
  - Request no longer sends `gender` (field is optional on the wire).
- `engine/types.ts`: `RecognitionTicket {requestId, expiresAt}`; `Session.recognition?`;
  `EngineDeps.startRecognition` / `resolveRecognition` replace `recognizeGarment`.
- `engine/engine.ts`: `image` event (in `NEW_PHOTO_STATES`) calls `startRecognition` and stores
  the ticket; `ASK_GENDER` reply calls `resolveRecognition(ticket, gender)` and clears it. The
  confirm / studio-handoff (`getReadiness`, `reportUnavailable`) / list fallbacks are unchanged.
- `deps.ts` wires both. Fakes (`test/helpers/engine-fakes.ts`) have `calls.recognize` and
  `calls.resolved`.

**Behaviour to know**
- `garment_recognitions.gender` (D54) is now **null** for new rows (gender unknown at request
  time) — anything grouping accuracy by gender will see a gap.
- Model names a kind the tapped gender lacks → list; metric `unmatched`.
- Dedupe is by case-insensitive **label**: same kind named differently across genders
  ("Kurta" men / "Kurti" women) stays separate options and will not map across.
- Prompt size: union over genders, deduped by label. The real factor vs one gender is
  **unmeasured**. Read-only query to get it: count `garment_subcategories` with a non-null
  `public_api_slug` grouped by `gender_slug`, and distinct labels overall.
- Sessions already in `ASK_GENDER` at deploy have no ticket → list. Harmless.
- Budget: `RECOGNITION_BUDGET_MS` (12s) now counts from the upload, not the gender tap.

## Verification run here
- `npx tsc --noEmit -p .` (apps/api): clean.
- `npx vitest run messaging whatsapp`: 132 passed.
- `npx vitest run --config vitest.integration.config.ts messaging-classify` (needs
  `pnpm docker:up`): 7 passed — includes one-option-per-label, same answer → each gender's own
  row, kind missing for the gender → null.
- `biome check --write` run on the changed files.
- **Not run:** real dispatcher/classify worker, real WhatsApp, full api suite, CI.

## Suggested next steps
1. Commit as two units (pose-label removal; early classification) on a feature branch and push.
2. Send a pose list and a garment photo through a real WhatsApp number: confirm no-body carousel
   cards are accepted and the new ordering (photo → gender → confirm) feels right.
3. Run the count query above; if the option list is still large/ambiguous, tune dedupe.
4. Decide the portrait approach (re-crop test first).
5. Add a `docs/progress.md` entry (CLAUDE.md asks for one) when committing.

## Environment notes from this session
- Files under `apps/api` are CRLF in the working copy; git warns "CRLF will be replaced by LF".
  Edits preserved line endings; biome reformatted 4 files.
- The permission classifier denied `caveman_retrieve` and `WebSearch` here; a hook elides long
  tool output, so use `python -c`/`sed -n` ranges to read function bodies.
- Branch policy / current branch: `dev` (14 commits were behind, now up to date). `origin/main`
  was fetched (`77c2161a`→`667edfaa`) but not merged into `dev`.

# WhatsApp bot — Flow 2 (confirm-first classification, pose count, confirm, generate)

Date: 2026-10-22 · Source of truth for copy and order: `Flow 2.pdf` (mockups, repo root).
Builds on `feat/whatsapp-early-classify-and-pose-cards` (commit `a24ecb3a`).

## Decisions (user, 2026-10-22)
1. **Confirm step before spending:** follow the mockup — count → summary → [Generate] / [Choose different number]. (Supersedes the earlier "generate immediately".)
2. **Classification at the upload step:** wait for the result right after the photo and ask "Is this correct?" before the gender question. Copy says "a top" (the kind), **not** "a women's top"; the gender is still asked afterwards.
3. **"No, different item":** ask the gender first, then show that gender's garment-type list.
4. **Count input:** a WhatsApp list with fixed options **1, 2, 3, 5**, each labelled with its credit cost (mockup), not a free 1–10 list.
5. **No pose showcase, no pose picking:** N random looks are drawn at Generate. "More poses" avoids looks already generated for this garment until the pool runs out.

## New flow

```
MAIN_MENU ─ New catalogue ─▶ ASK_GARMENT_PHOTO
  photo ─▶ recognise kind (wait ≤ RECOGNITION_BUDGET_MS)
     hit  ─▶ CONFIRM_KIND  "I've analysed the image and it looks like a <kind>.\nIs this correct?"
                [Yes, continue] [No, different item]
                Yes ─▶ ASK_GENDER (keeps kind)        No ─▶ ASK_GENDER (kind dropped, correction counted)
     miss ─▶ ASK_GENDER (no kind)
  ASK_GENDER  "Great! 👍\nCreate this catalogue for:"  list Men / Women / Boys / Girls
     kind kept ─▶ map kind → that gender's row by label
        row found and offerable ─▶ (extra photos if the type needs them) ─▶ ASK_POSE_COUNT
        row not offered for the gender, or not found ─▶ existing studio hand-off / list fallbacks
     no kind  ─▶ ASK_GARMENT_TYPE (list) ─▶ pick ─▶ (extra photos) ─▶ ASK_POSE_COUNT
  ASK_POSE_COUNT  summary + list [1 pose (10 credits)] [2 poses (20 credits)] [3 …] [5 …]
  CONFIRM_GENERATE "Perfect! You've selected N poses.\nCategory: … | Garment: …\nCredits required: …\nRemaining balance: …\nDo you want to proceed with N poses?"
                [Generate] [Choose different number]
  Generate ─▶ GENERATING "Generating your N poses…\nWe're creating your catalogue images.\nThis may take a few seconds."
  DELIVERED "Here are your N generated poses!\nCategory: … | Garment: …\nCredits used: …\nRemaining balance: …"
            + the images, then "What would you like to do next?" [More poses] [Change garment] [New catalogue]
```

Copy is taken verbatim from the mockup except where the mockup is ambiguous (button titles are clipped to 20 chars, list row titles to 24 by `render.ts`). Existing extra-photo steps (`ASK_EXTRA_PHOTO`) and failure/Retry paths are unchanged.

## Engine changes (`apps/api/src/modules/messaging/engine/`)

**States:** add `CONFIRM_KIND`, `ASK_POSE_COUNT`, `CONFIRM_GENERATE`; remove `PICK_LOOKS`. `ASK_GENDER` now follows the kind confirmation.

**Session fields:**
- `kind?: string` — the recognised kind's label (from the all-genders, label-deduped candidate list). Replaces `recognition?: RecognitionTicket` and the `RecognitionTicket` type.
- `count?: number` — the chosen N, set at `ASK_POSE_COUNT`, read by `CONFIRM_GENERATE`.
- `seenLooks: string[]` — look ids already generated for this garment. Cleared by a new photo / `cleared()`; kept by "More poses" and "Choose different number".
- `picked` is kept: it holds the looks drawn at Generate and is what delivery and Retry read (`retryLookIds`).

**Image event:** `deps.recognizeKind(garmentKey)` (start + wait). Hit → `CONFIRM_KIND` with `kind` set; miss/off/timeout → `ASK_GENDER`. The seller waits up to 12 s with no message; see Risks.

**Replies:**
- `CONFIRM_KIND`: `confirm` → `ASK_GENDER` keeping `kind`; `change` → drop `kind`, `recordRecognitionCorrected()`, `ASK_GENDER`.
- `ASK_GENDER`: tap sets gender. With `kind`, `deps.typeForKind(kind, gender)` returns the gender's row (same public-slug list recognition used). Found → look it up in `listGarmentTypes(gender)`; present → existing `chooseGarmentType(..., recognized=true)` (no second "Looks like" confirmation, it was already given); not offerable → existing hand-off with readiness reasons; no row for the gender → type list. No `kind` → type list.
- `ASK_POSE_COUNT`: `count` reply (values from the fixed set) → `CONFIRM_GENERATE`. Options offered are those with `n × perImage ≤ balance` and `n ≤ pool size`; none affordable → `NO_CREDITS`; if only some are affordable the rest are not offered.
- `CONFIRM_GENERATE`: `generate` → draw + existing `generate()`; `recount` → `ASK_POSE_COUNT`. Balance re-checked at tap (existing rule: tapping Generate is the agreement to spend, D45).

**Random draw:** at Generate, `loadPool` (fresh), candidates = pool minus `seenLooks`; if fewer than N remain, take them all and top up from the rest of the pool (so N looks, distinct, whenever the pool has ≥ N). Result → `picked`; `seenLooks` gets the drawn ids when the run starts. The shuffle sits behind `EngineDeps.sample(items, n)` so tests fix the outcome. The existing quote → create → partial-start/Retry machinery in `generate()` is unchanged.

**Removed:** look tap / clear / Generate-on-selection handlers, `cardsMsgs` use for poses, look paging and "More" for looks, copy `pickCards`/`pickFooter`/`selected`/`pickAtLeastOne`/`pickCap`, and the `MAX_PICKS` cap (N is bounded by the fixed set and the pool). `render.ts` carousel code stays unused (separate cleanup).

## Classification API (`classify.ts`)

Replace `startRecognition`/`resolveRecognition` (ticket-based) by:
- `recognizeKind(app, garmentKey, opts?)` → `{ label } | null`: build the all-genders, label-deduped candidates, queue the request, wait ≤ budget, `matchAnswer`. Outcome metrics as today (`matched` | `unmatched` | `timeout` | `no_worker` | `failed`), counted here.
- `typeForKind(app, label, gender)` → `{ garmentTypeId, label } | null`: the gender's public-slug type with the same normalised label. Synchronous (cached options). A miss is logged at info, not counted as a second outcome.

`RecognitionTicket`, the ticket field on `Session`, and `waitForResult`'s "check once with no budget" tweak (only needed for the old overlap design) can go; keep the check-once behaviour if it is harmless. The request still carries no `gender`; `garment_recognitions.gender` stays null for new rows (as in `a24ecb3a`).

## Compatibility
Sessions stored in Redis during deploy: a session in state `PICK_LOOKS` or carrying `recognition` is mapped on load — `PICK_LOOKS` → `ASK_POSE_COUNT`, `recognition` dropped. (One small branch where sessions are parsed; if that is not centralised, fall back to the generic stale/re-render path.) Session TTL bounds the exposure to 24 h.

## Tests
- Engine (fake deps): photo → hit → `CONFIRM_KIND` copy; Yes → gender → type resolved for the gender → `ASK_POSE_COUNT`; No → gender → list + correction counted; miss → gender → list; kind with no row for the gender → list; non-offerable kind → hand-off (reasons reported); count options capped by balance and pool; none affordable → `NO_CREDITS`; confirm → draw N distinct looks; "Choose different number" returns to the count list; "More poses" excludes `seenLooks` and refills when exhausted; stale `BAD_CATALOG` re-asks the count; Retry still works.
- Render: list rows with the credit-labelled titles stay within `ROW_TITLE_MAX` (24).
- Integration (`messaging-classify`): `recognizeKind` one-option-per-label request, answer→kind; `typeForKind` maps each gender's own row; budget/disabled/no_worker → null.

## Risks / open items
- **12 s silent wait** after the photo (decision 2). A "Analysing your photo…" text or WhatsApp's typing indicator would fix it, but the engine returns messages only after the step completes; sending one earlier needs an outbound hook. Not in scope; flagged for a follow-up.
- Real-device checks still outstanding from the handoff: list rows with long titles, the new ordering feel, card-body-optional is already confirmed by Meta docs (no longer a risk).
- Fixed options {1,2,3,5} are a constant in the engine (mockup), not admin-configurable; add configuration only if asked.
- "Garment: Top" in summaries uses the type's label as stored; "Category" is the gender label.

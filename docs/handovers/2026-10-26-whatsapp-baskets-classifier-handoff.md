# Handover: WhatsApp baskets + ranked garment classifier

**For:** the next Claude Code agent (continuing on another machine)
**From:** Claude, session of 2026-10-26. Design agreed with the user, one slice built (admin page rename), the rest not started.
**Branch:** start from `dev`. The admin rename in "Already done" is **uncommitted** on the other machine's checkout unless the user pushed it; check `git log`/`git status` first and, if missing, redo it from the description below (it is small).
**Read first:** `CLAUDE.md` (esp. Production safety, Commits and pushes, "Decisions get a tradeoff"), then `docs/progress.md` top entries.

## 1. Goal

Today the WhatsApp bot classifies the garment photo into **one** garment type and shows it with "Looks like a …, correct?". Many garment types share one ComfyUI workflow, so a job's result is the same for any of them. What the seller must confirm is the **basket** (the group of types sharing a workflow), not the exact type.

New flow:

1. Seller sends a garment photo.
2. Bot asks **gender first** (today the order is photo → classify → gender).
3. Api asks the classifier to score **every single-image garment type for that gender**.
4. Api sums the per-type probabilities **per basket** and takes the top basket.
5. Bot: "Looks like *<basket name>*. Correct?" plus the next 2–3 baskets as alternatives. If the classifier is down or the top basket is weak, fall back to today's full type list.
6. On confirm, the basket resolves to its **representative type** and the existing path runs unchanged: poses → count → quote → `createRun`. The job's `garmentTypeId` is the representative type.

Why sum probabilities per basket: individual types inside a basket are visually near-identical (tank top vs vest, trouser vs formal), so the model splits its probability between them. The basket sum is stable even when no single type is confident.

## 2. Decisions already made (do not re-litigate)

- Baskets are created **manually in admin**, not derived. Admin page: **WhatsApp** (renamed from Classify Service).
- The classifier keeps predicting **garment types**, not baskets. Options sent = the gender's types; baskets are applied in the api afterwards. No basket descriptions to write.
- Gender is asked **before** classification.
- **Single-image types only.** Any type that takes more than one image is excluded from WhatsApp: `requiresLowerUpload`, `requiresThirdUpload`, **and** `allowsFourthUpload` (even though the saree blouse is optional, the user said "only one image garment types"). Scope is **WhatsApp only**; the studio and Shopify keep those types.
- Representative type per basket: admin marks one explicitly; if none marked, fall back to the first ready type by sort order. (Recommended by Claude; the user asked what it meant and was told it defaults safely. Treat as accepted unless the user objects.)
- No new model. Reuse the Qwen2.5-VL service already on the GPU box with its scored mode (section 5).

## 3. Already done (uncommitted at time of writing)

Admin SPA (`apps/admin-web/src`), typecheck clean, lint at baseline (17 warnings, 0 errors). **Not opened in a browser.**

- `pages/ClassifyServicePage.tsx` → `pages/WhatsAppPage.tsx` (`git mv`). Heading "WhatsApp". Tabs: **Classifier** (old Overview), **Poses**, **Requests**, **Logs**. Tab ids: `overview`, `whatsapp-poses`, `requests`, `logs`.
- Route `/whatsapp`; `/classify-service` and `/garment-recognitions` redirect (the latter to `?tab=requests`) in `App.tsx`. Sidebar item `k: 'whatsapp'`, label "WhatsApp". `PATH_LABELS` updated.
- The WhatsApp Poses tab moved out of Assets. It still depends on `AssetsProvider`/`useAssetsContext`, so `WhatsAppPage` mounts it inside its own `AssetsProvider` only on that tab (`PosesPane`), and `WhatsappPosesTab` got an `embedded` prop that hides its own page heading. Removed from `AssetsPage.tsx` tab list and `AssetsContext.tsx` (`AssetTab`, `VALID_TABS`). Old `/assets?tab=whatsapp-poses` bookmarks fall back to Garment Types.
- Backend admin endpoints are unchanged (`/admin/classify-service/*`, `/admin/garment-recognitions/*`).

## 4. Evidence gathered (so you need not redo it)

Test set: the 21 garment photos in the repo root (`baggyjeans.jpg` … `vest.jpg`; gitignored via `*.jpg`). Mostly men's catalog-style shots. They are easier than real seller photos; treat accuracy as optimistic.

| Approach | Top-1 type | Basket top-1 |
|---|---|---|
| Marqo-FashionSigLIP / FashionCLIP / SigLIP 2 (open_clip, zero-shot, men's flows only) | 17–19 / 21 | 19 / 21 |
| **Qwen2.5-VL scored on the GPU box** (the path we are building) | 16 / 21 (top-3: 20/21) | **19 / 21** |

Qwen scored latency: median 121 ms, max 189 ms. Basket sums there used only the top 3 types (the server returned 3); returning all should only help.

Consistent misses (every model): `jeans` read as baggy jeans; `onepiecesuit` read as two piece suit / trouser; `tank top` ↔ `vest` and `trouser` ↔ `formal` swap (same basket, so harmless). Without gender, most "misses" were exact 50/50 ties between identical-looking women/men baskets, which is why gender comes first.

The sample ground-truth labels live only in the scratch scripts (not in the repo). If you rebuild the evaluation, map file → expected type/basket by hand; `formal.jpg` is navy formal **trousers**, not a shirt.

## 5. The GPU classify service (separate system, `aivastra-gpu` repo)

`CLAUDE.md` says GPU boxes run no code from this repo. The classify service is the one place this work touches one. Findings from a read-only inspection of the classify box (SSH details were given to the previous agent in chat; ask the user, do not commit them):

- `classify.service` runs `uvicorn server:app` on `127.0.0.1:8400` from `~/classify` (venv at `~/classify/venv`, secrets in `~/classify/env`, a Cloudflare tunnel `classify-tunnel.service` in front). Model: `Qwen/Qwen2.5-VL-7B-Instruct`, always resident.
- RTX PRO 6000 Blackwell, 97 GB VRAM, ~17 GB used. **Disk is 94% full (8.6 GB free)**: do not download large models there.
- Live `server.py` exposes `/health`, `/logs`, `/classify` (image + `prompt` + `max_tokens` → `{answer, ms}`).
- **`~/classify/server_scored.py` already exists but is not deployed.** It is a drop-in superset: `/classify` additionally accepts `options` (a JSON list of key strings) and `min_confidence`, scores `log P(key | image, prompt)` for every option as a closed set in one batched pass over the shared KV cache, softmaxes into probabilities, and returns `{answer, confidence, top:[{slug,p}] (top 3 only), ms}`. Without `options` it behaves like `server.py`. It was exercised for the first time in this session (second instance on port 8401, then stopped and cleaned up; live service untouched).
- **Needed GPU change:** make it return **all** options' probabilities (e.g. `ranked: [{slug,p}…]`, not just the top 3), then switch the unit to it (`ExecStart … server_scored:app`). Back up `server.py` first and keep `restart on failure` behaviour. This is the user's box: **ask before deploying**, and mirror the change into the `aivastra-gpu` repo (it is the source of truth for that box).
- The dispatcher currently posts only `prompt` and `max_tokens` (`apps/dispatcher/src/classify/process.ts`), never `options`, so the scored path has never been used in production.

Correction to an earlier statement in the session: Qwen *can* produce probabilities here; ignore any suggestion that a separate embedding model is required.

## 6. What to build, in order

### 6.1 Schema (migration; do **not** run against prod, see CLAUDE.md)
- New table for baskets, e.g. `whatsapp_baskets`: `id`, `gender_slug`, `name`, `representative_subcategory_id` (nullable FK → `garment_subcategories`), `sort_order`, `is_active`, timestamps.
- Membership: a nullable `whatsapp_basket_id` on `garment_subcategories` (a type belongs to **at most one** basket; types are per-gender rows, so a basket is per gender; enforce member gender = basket gender).
- Generate with `pnpm db:generate` locally/staging only; ship through CI → `db:migrate:prod`. Check `docs/version-control.md` for migration-conflict rules and the `scripts/check-migrations-sync.sh` pre-push hook.

### 6.2 Single-image filter (WhatsApp only)
- Define one predicate: eligible ⇔ `!requiresLowerUpload && !requiresThirdUpload && !allowsFourthUpload` (also consider `requiresMannequinStep` / two-input templates; saree two-step is already handed to the studio today).
- Apply in: the bot's type list (`deps.listGarmentTypes` in `apps/api/src/modules/messaging/deps.ts`), the classifier option builder (`kindCandidates` / `publicTypes` in `messaging/classify.ts`), the admin basket member picker (show ineligible types disabled with the reason), and server-side validation when assigning a member.
- The bot's `ASK_EXTRA_PHOTO` step becomes unreachable. Remove it in a **separate** cleanup commit, not mixed into the feature.

### 6.3 Contract (packages/types, api ↔ dispatcher)
`packages/types/src/garment-recognition.ts`:
- `GarmentRecognitionResult`: add optional `ranked: {slug: string; p: number}[]` (best first, **all** options). Keep `answer` (top slug) so an old dispatcher/worker still parses.
- `GarmentRecognitionRequest` already has `options` and optional `gender`; keep sending both.

### 6.4 Dispatcher (`apps/dispatcher/src/classify/`)
- `process.ts` service path: also send `options` (JSON list of slugs) in the multipart form and read `ranked`/`top` from the response; write it into the result. The ComfyUI fallback path cannot rank: it returns `answer` only, and the api must treat a missing `ranked` as "single answer, no ranking" (degrade to today's behaviour).
- `record.ts` stores a row per request in `garment_recognitions`; consider persisting `ranked` there for the Requests tab. The persisted `options` should stay the sent list.

### 6.5 Api (`apps/api/src/modules/messaging/`)
- `classify.ts`: `recognizeKind` becomes gender-aware: take the gender, build options = that gender's eligible public types (not the cross-gender label union used today), send, then aggregate `ranked` into baskets (sum `p` per basket; a type with no basket is its own singleton basket so it can still win). Return an ordered list `[{basketId, name, score}]` (top basket + alternatives) or `null` on any failure.
- Fall back to the full type list when: classifier disabled/unreachable/timeout, no `ranked`, or the top basket score is below a threshold. **Pick the threshold from data**, not guesswork (the Requests tab / `garment_recognitions` have real answers and seller corrections; `recordRecognitionCorrected` already counts "No, different item").
- `engine/engine.ts`: reorder states to gender → classify → confirm basket. Today `startFromPhoto` classifies first and `pickGender` maps the kind to the tapped gender; both change. `typeForKind` is replaced by basket → representative type. Reuse `chooseGarmentType` after confirm. "No, different item" shows the next-ranked baskets first, then the full list.
- Update `engine/copy.ts` (e.g. `kindGuess` becomes a basket guess; button titles ≤ 20 chars, list rows ≤ 24) and the tests: `apps/api/test/messaging-classify.test.ts`, `messaging-engine.test.ts`, `apps/api/test/integration/messaging-classify.test.ts`, `whatsapp-*.test.ts`.
- Representative type must be **ready** (poses, face, background) at confirm time; reuse `getReadiness`/`reportUnavailable` as `pickGender` does for unready types, and hand off to the studio when none of a basket's members is ready.

### 6.6 Admin Baskets tab (`apps/admin-web/src/pages/WhatsAppPage.tsx`)
- New **Baskets** tab: list/create/edit/delete (soft: prefer `is_active=false`), pick gender, name, tick member types from the gender's types (ineligible ones disabled with reason), mark the representative, reorder. Admin writes go through `requirePermission` and `recordAudit(tx, …)` in the same transaction (see Invariants in `CLAUDE.md`). Follow `docs/admin-url-routing-standard.md` for URL-driven state, and use `SearchableSelect`, never a raw `<select>`.
- New admin routes under `apps/api/src/modules/admin/` and wired in `apps/api/src/server.ts`.

### 6.7 Docs
- Update `docs/superpowers/diagrams/whatsapp-bot-flow.drawio` (gender first, basket confirm, alternatives, fallback). The diagram was last refreshed 2026-10-26 for the shorter bot copy; edit the XML with a script as before, then validate it parses.
- Log in `docs/progress.md`: the GPU service change, the new table, and any out-of-repo state (box deploy).

### 6.8 GPU (user's go-ahead required)
Section 5. Deploy the full-probabilities scored server, verify `/health` and one real `/classify` with `options`, keep `server.py` as the rollback.

## 7. Baskets seed data (from the user's spreadsheet)

The user's CSV (`Untitled spreadsheet - Sheet1.csv`, untracked in the repo root on the first machine) maps ComfyUI flows → garment types. Typos normalised below; entries marked `?` are ambiguous and need the admin/user to confirm. Seed these through the admin UI or a staging/local script, **never** a prod hand-edit.

| Basket (flow) | Garment types |
|---|---|
| two piece | full sleeve shirt, half sleeve shirt, half sleeve t-shirt, full sleeve t-shirt, sweatshirt, hoodie, top, crop top |
| one piece | knee length frock (flat, mannequin), mini frock (flat, mannequin), kurti (mannequin), chudidar (mannequin), jumpsuit |
| cocktail | cocktail |
| blazer and jacket | blazer, jacket |
| kurthi | kurti, kurti and pyjama |
| lehenga | lehenga, half saree |
| saree | saree on mannequin |
| one piece suit | one piece suit |
| two piece suit | two piece suit, co-ord set |
| chudidar | chudidar, anarkali |
| lower women | jean, trouser, track, mini skirt, short |
| long skirt | long skirt |
| baggy women | baggy women |
| women innerwear | women innerwear |
| men lower | cargo, trouser, jean, formal, track |
| baggy lower men | baggy lower men |

Notes: `trouser`, `jean`, `track` appear in both "lower women" and "men lower"; since types are per-gender rows and baskets are per gender they do not collide. "(flat, mannequin)" in the one-piece rows means that type has both a flat-lay and an on-mannequin variant; treat each as its own type row. **The CSV has no basket for men's uppers (shirt, polo, vest, tank top), kurta, sherwani & pyjama, shirt & trouser, or any boys/girls type**; the evaluation used provisional names ("men upper", "men kurta", "sherwani", "shirt and trouser"). Ask the user for the real groupings before seeding those. Several multi-image production types (e.g. kurta & pyjama sets, shirt & trouser) will be ineligible under the single-image rule anyway.

The production garment-type list the user pasted (slug → label, ~60 types) is in the original session only; read the real list from `garment_subcategories` (reads against prod are fine, writes are not) or the admin Garment Types tab.

## 8. Open questions / risks to carry forward

- **Does price or credit plan vary by garment type?** If so, running a "jean" job as "trouser" could change the quote. Verify in `quoteRun`/`createJob` before shipping.
- **Do all member types in a basket really share pose configs and the workflow?** The workflow is chosen per pose per type in `pose_garment_configs.workflowTemplateId`, not on the type. Nothing in the DB guarantees that two types in a basket have the same poses/catalog defaults. Surface mismatches in the Baskets tab (compare each member's configs against the representative's) or at least log them.
- **Accuracy on real seller photos is unmeasured.** Pull labelled recognitions (`garment_recognitions` + corrections) and rerun the basket-level evaluation before fixing the fallback threshold.
- **Qwen scored `onepiecesuit` at 0.02** and confuses baggy/normal jeans: expect those baskets to rely on the "No, different item" path. Consider a short, human description in the option label for known-confusable pairs only after measuring.
- The classifier's key-only prompt lives in the admin-edited classify workflow template (`CLASSIFY_OPTIONS_PLACEHOLDER` `{{OPTIONS}}`, admin → Workflows → Garment recognition). The scored service reads `prompt` + `options`; keep both consistent so the keys in the prompt equal the scored keys.
- Pre-push hooks run `git diff HEAD main`; a local `main` branch tracking `origin/main` must exist (`git branch main origin/main`), or every hook fails with "bad revision 'main'".
- Windows note: long paths break big pip installs; use a short venv path if you need to rerun the open_clip comparison (not needed for the build).

## 9. Conventions reminders

Per `CLAUDE.md`: no commit/push unless asked; commit only complete units (migration + api + UI together, not CSS tweaks); never print secrets; schema/migration work never against prod; branch → PR to `dev` → PR to `main`; report honestly what was and was not run. This work is UI-heavy: **open the admin page and the bot flow in a real run before claiming it works** (the rename above has only been typechecked).

# WhatsApp bot v2 — no dead ends, one readiness answer

**Status:** draft for review, 2026-10-21. No code written.
**Amends:** `2026-10-12-whatsapp-catalog-bot-design.md` (D16/D31 saree exclusion, D47 type
availability, spec 8a recognition) and `2026-10-14-whatsapp-pose-selection-design.md` (nothing
reversed). Everything else stands.
**Source:** the v2 architecture proposal (2026-10-19), narrowed after reading the `dev` engine.

## 1. Summary

The conversation already does what sellers need: photo → gender → recognised and confirmed (or
listed) type → extra photos → look picks → generate. v2 does **not** redesign it. It fixes the
places where a seller loses their photo, and it replaces three scattered "can the bot offer this?"
checks with one.

Two things the proposal got wrong are corrected here: the confirm step (`CONFIRM_GARMENT_TYPE`)
already exists, and the FlowPlan rewrite of the engine is not needed.

## 2. Verified current behaviour (`dev` at `f5c8e79e`)

```
photo -> ASK_GENDER -> [tap] -> recognizeGarment (waits up to 12 s)
  hit  -> CONFIRM_GARMENT_TYPE -> Yes -> chooseGarmentType
  miss -> ASK_GARMENT_TYPE (list) -> chooseGarmentType
chooseGarmentType -> face? -> templates/looks? -> ASK_EXTRA_PHOTO -> PICK_LOOKS -> generate
```

Four paths end in `notAvailable()` (`engine/engine.ts`), which clears the session and returns to
`MAIN_MENU`:

| # | Path | Where |
|---|---|---|
| 1 | Recognised type is not in `listGarmentTypes` | `ASK_GENDER` handler |
| 2 | No default face for gender + type | `chooseGarmentType` |
| 3 | No active template | `loadPool` (`no_template`) |
| 4 | Templates exist, no eligible look | `loadPool` (`no_eligible_looks`) |

The seller gets "X catalogs aren't available on WhatsApp yet… <studio>" with a plain `/studio`
link. The photo, gender and type are lost. `reportUnavailable` only logs.

"Can the bot offer this type?" is decided in three places: `deps.listGarmentTypes` (drops
`requiresMannequinStep` types and types with no active template for the gender), `chooseGarmentType`
(face) and `loadPool` (templates, looks). Recognition candidates come from the catalog-options
cache (`classify.ts`) and know about none of them.

## 3. Decisions

| # | Decision | Detail |
|---|---|---|
| V1 | One resolver | `resolveGarmentReadiness(gender, typeId)` returns `ready` / `degraded` / `blocked` plus `reasons[]` (`inactive`, `mannequin_flow`, `no_mapping`, `template_inactive`, `no_face`, `no_eligible_looks`, `missing_default_lower`, `missing_default_shoe`). Replaces the three checks. Reads the same tables the studio reads. Pure read; no data fix. |
| V2 | Resolver feeds recognition routing | Recognition keeps all candidates (accuracy). The resolver decides what happens with its answer: ready → confirm; blocked or web-only → hand-off; none → list. |
| V3 | Studio hand-off replaces the dead end | A blocked or web-only type, or any of the four paths in section 2, sends a `/studio?draft=…` link that pre-fills gender, type and garment key. The photo is already in our storage, so nothing is re-uploaded. The session is kept so "Pick another type" works. |
| V4 | Unavailable reasons reach admins | `reportUnavailable` becomes a counter (Prometheus) plus an alert when ready types for a gender drop to zero or by half in an hour. Would have caught the October incident (140/140 templates inactive). |
| V5 | Saree is data-driven | The two-step flow stays out (D16/D31). When the single-step saree workflow ships, the type passes V1 once `requires_mannequin_step` is false and an active template is mapped. No bot code change. Until then it gets the V3 hand-off. |
| V6 | Admin readiness matrix | Gender × type grid on the admin Garment Types screen, each red cell with its reason and a link to the screen that fixes it. Template active state shown next to the mapping toggle. |
| V7 | Out of scope | FlowPlan engine rewrite, in-chat mannequin flow, body type in chat, optional shoe/lower picks, batch, in-chat payment links, new languages. |

## 4. Phases

| Phase | Contents | Seller-visible |
|---|---|---|
| P0 | V1, V3, V4, V5-interim. Resolver in api; `engine.ts` and `deps.ts` call it; draft link; metrics. | Dead ends become a hand-off with the photo loaded. |
| P1 | V6 admin matrix and template-state display. | None. |
| P2 | Parallel recognition: start on photo arrival, cache result in Redis, score every gender's types in one pass. Scored answer with top-3 and confidence; close calls show top-3 buttons + Other. Needs GPU time per photo measured first (about 4× the options). | Wait after the gender tap mostly gone; top-3 on close calls. |

P0 and P1 are independent of P2. P2 depends on the scored classify endpoint, which exists only as a
GPU-box prototype today.

## 5. Tradeoffs

**Where the readiness rule lives**

| Option | Developers | Sellers |
|---|---|---|
| Keep three checks (today) | No work; they drift, as in October | Dead ends |
| **One resolver in api (chosen)** | One module, cached ~1 min, invalidated on admin writes; touches `deps.ts`, `engine.ts` | Bot and admin agree |
| Resolver in `packages/` shared with the studio | Largest blast radius; changes the 6,600-line studio page | None extra now |

The studio can adopt the resolver later; it is not in scope here.

**Dead-end handling**

| Option | Developers | Sellers |
|---|---|---|
| Plain "not available" (today) | None | Photo lost |
| **Draft link (chosen)** | New studio route reads a draft; photo key already bound to the user | One tap, nothing re-uploaded |
| Ask for the missing item in chat | New steps and session state | More taps; deferred |

## 6. Open points

1. **Saree rollout:** flip `requires_mannequin_step` on the existing saree subcategory, or ship a
   new subcategory? Flipping also changes the web studio.
2. **Saree photos:** one photo, or body + pallu? Sets which `requires_*_upload` flags apply.
3. **Draft link:** does the studio already accept pre-filled gender/type/garment key, or does it
   need a small query-param reader? Not yet checked.
4. **Draft ownership:** the link must not expose another user's garment key. Bind to the signed-in
   user (as `uploads` ownership binding does) rather than trusting the URL.
5. **P2 GPU cost:** measure per-photo time for the all-genders scored pass before committing.

## 7. Testing

- Unit: resolver decision table (each reason, degraded vs blocked).
- Engine unit tests (`messaging-engine.test.ts`): each of the four section 2 paths now ends in the
  hand-off with the session kept.
- Integration: an inactive template yields `blocked` and a hand-off, not a cleared session.
- No production writes; the resolver only reads.

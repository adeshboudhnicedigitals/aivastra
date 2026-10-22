# Handoff — WhatsApp try-on flow (admin backend done, user flow next)

Branch: `feat/whatsapp-tryon-flow` (from `feat/whatsapp-early-classify-and-pose-cards`). Pushed; no PR yet.
Spec: `docs/superpowers/specs/2026-10-22-whatsapp-tryon-flow-design.md` (draft; its per-pose-workflow
and `watermark:false` lines are superseded — see "Decisions"). Plan: `docs/superpowers/plans/2026-10-22-whatsapp-tryon-flow.md`.

## What exists
- Bot flow behind `WHATSAPP_BOT_FLOW=tryon` (default `catalogue`, untouched): garment photo → gender
  (Men/Women/Boys/Girls) → 1/3/5 poses (credits shown) → direct try-on jobs → delivery.
  Split 1 = 1 Full, 3 = 2 Full + 1 Half, 5 = 3 Full + 2 Half; Full drawn first; no Back poses.
  Code: `apps/api/src/modules/messaging/{tryon-jobs,tryon-deps,conversation}.ts`, `engine/{tryon-engine,tryon-rules,copy,types}.ts`.
- Pool: `model_pose_assets.whatsapp_pool` (migration `0230_lush_orphan.sql`, additive).
- One workflow for every WhatsApp job: `config:system.whatsappTryon.workflowTemplateId` (Redis, edited via
  `PATCH /admin/config`). No workflow, or not an active `tryon` template ⇒ the bot offers no poses.
- Admin: Assets → **WhatsApp Poses** tab: workflow selector, per-gender "Bot can offer" strip,
  Add from Pose Assets (legacy untyped poses get Add as Full/Half), Move to Half/Full, Remove.
- Connect flow polish (CTA button, success screen with countdown, welcome/menu copy) is in commit 9dba1e5d.

## Decisions (user-approved unless marked)
- Poses' own workflows are NOT used (they are `regular` and the catalogue flow needs them). *Approved.*
- `whatsapp_tryon` jobs are excluded from the studio gallery; results live in chat. *Not yet confirmed.*
- Free-plan images are watermarked (plan uses `resolveQueueRouting`; spec said none). *Not yet confirmed — decide.*
- Tapping a count is the agreement to spend; no confirm step; no Retry button; closing buttons Make more / New garment / Menu. *Assumptions, not confirmed.*

## Set up on the new machine
1. `pnpm install`, `pnpm docker:up`, **`pnpm db:migrate`** (local only; never against prod). Without 0230 the admin pose list 500s on `whatsapp_pool`.
2. `pnpm --filter @aivastra/types build` (dist must contain `whatsappTryon`).
3. In admin: create/choose an active `tryon` workflow (inputs: person + garment), pick it on the WhatsApp Poses tab,
   tag poses with a gender, add ≥3 Full + 2 Half per gender to offer all of 1/3/5.
4. Set `WHATSAPP_BOT_FLOW=tryon` in `.env`, restart api.

## Verify
- `cd apps/api && npx tsc --noEmit`
- `npx vitest run messaging whatsapp tryon`
- `npx vitest run --config vitest.integration.config.ts admin-whatsapp-pool messaging-tryon-jobs messaging-tryon-conversation admin-job-taxonomy whatsapp-inbound messaging-connect`
- Known failing before this work (leave): `messaging-conversation` ×2, `whatsapp-hooks` NO_CREDITS pose-cards.

## Next: refactor the WhatsApp user flow
Not started. Brainstorm first (user will say what to change in the chat journey). Things to keep in mind:
copy keys live in `engine/copy.ts`; WhatsApp limits (button ≤20, list row ≤24, ≤10 rows); every button id carries a session nonce;
old catalogue engine stays until the new flow is approved, then it can be removed.

## Open / minors
- Blank `WHATSAPP_BOT_FLOW=` fails startup instead of defaulting; `no_poses` reuses the garment-unavailable metric;
  partial-start failure not logged; rate limit applied per pose, not per run; no test for PATCH `shotType`.
- Unverified on a real phone: CTA button opening WhatsApp's in-app browser, `wa.me` landing, list rows; real-number end-to-end run.
- Untracked `allinonetryon.json`, `*.jpg`, `*.pdf` in the repo root are not part of this work.

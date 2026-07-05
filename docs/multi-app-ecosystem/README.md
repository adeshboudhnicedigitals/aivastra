# Multi-App Ecosystem — Phase Handoff Workflow

The full design lives in [`../multi-app-ecosystem-plan.md`](../multi-app-ecosystem-plan.md). This folder splits it into one **standalone handoff document per phase**, so each phase can be handed to Codex as a single bounded unit of work, reviewed, and merged before the next phase starts.

## Process

1. Hand the next `phase-N-*.md` file to Codex. Each file is self-contained — it restates the relevant context, the exact spec, and a checklist — so Codex doesn't need to read the master plan to execute correctly.
2. Codex implements the phase and fills in the **Report Back** section at the bottom of that phase's file (files touched, migration index used, test output, any deviations or judgment calls).
3. Claude reviews the diff against that phase's **Definition of Done**, runs the relevant test/typecheck/lint commands, and checks the specific legacy-debt fixes and CLAUDE.md invariants called out in the file. Findings go back to the user before the phase is considered closed.
4. Update the status table below **and add a dated entry to `docs/progress.md`** (repo convention: every executed plan gets a progress entry — Done / Failed / Open Questions), then move to the next phase per the dependency order.

Only Phase 0 → Phase 2 → Phase 3 is a hard chain. Phase 1 is independent (parallelizable with 0/2). Phase 5 only needs Phase 2. Phase 4 is a one-line doc edit, any time.

## Status

| Phase | File | Status | Depends on |
|---|---|---|---|
| 0 — Auth Foundation | [`phase-0-auth-foundation.md`](phase-0-auth-foundation.md) | Implemented, awaiting review | — |
| 1 — Admin Subdomain | [`phase-1-admin-subdomain.md`](phase-1-admin-subdomain.md) | Not started | — (parallel with 0/2) |
| 2 — Merchant Portal | [`phase-2-merchant-portal.md`](phase-2-merchant-portal.md) | Not started | Phase 0 |
| 3 — Kiosk Migration | [`phase-3-kiosk-migration.md`](phase-3-kiosk-migration.md) | Not started | Phase 0, Phase 2 |
| 4 — Process Note | [`phase-4-process-note.md`](phase-4-process-note.md) | Not started | — (any time) |
| 5 — Shopify/Wix Plugins | [`phase-5-ecommerce-plugins.md`](phase-5-ecommerce-plugins.md) | Not started | Phase 2 |

Update the Status column as phases move through: `Not started` → `In progress` → `Implemented, awaiting review` → `Reviewed — changes requested` → `Done`.

## Handover prompt (paste into Codex, swap the phase filename)

> You are implementing one phase of a multi-phase plan in this repository.
>
> Your spec is `docs/multi-app-ecosystem/<PHASE-FILE>.md`. Read it fully before touching anything — it is self-contained and authoritative for this task. The master design doc `docs/multi-app-ecosystem-plan.md` is background rationale only; if the two ever disagree, the phase file wins, and you flag the discrepancy in your report instead of resolving it yourself.
>
> Also read the repo root `CLAUDE.md` before starting — it defines the conventions (migrations, testing harness, logging, commit policy) the phase file assumes.
>
> Rules:
> 1. **Scope:** implement exactly this phase. No work that belongs to later phases, no refactoring of unrelated code, no unrequested improvements. If something outside scope seems necessary, note it in the Report Back section instead of doing it.
> 2. **The phase file's "Definition of Done" is the acceptance bar.** Never edit the spec or DoD to make them pass. The only section of the phase file you may edit is "Report Back".
> 3. **Migrations:** before creating one, re-check `packages/db/src/migrations/meta/_journal.json` for the current highest index — never trust index numbers written in the spec.
> 4. **Tests need live infra:** run `pnpm docker:up` first. Every test listed in the DoD, plus the repo-wide typecheck, must actually pass — paste real command output in Report Back; never claim untested success.
> 5. **On contradiction** between the spec and the actual code (a referenced function/pattern has changed, a stated fact no longer holds): stop that thread, document what you found in Report Back, and continue only with the unaffected parts.
> 6. **When done:** fill in the phase file's Report Back section completely (files created/modified/deleted, migration index used, test output, deviations, judgment calls), set this phase's row in `docs/multi-app-ecosystem/README.md` to `Implemented, awaiting review`, and commit your work locally in logical commits. **Do not push.**

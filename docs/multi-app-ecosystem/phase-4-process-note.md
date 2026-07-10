# Phase 4 — Process Note

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §9). This document is self-contained — implement from this file directly.

**Depends on:** nothing. **Blocks:** nothing. Can be done at any time, independent of every other phase. **User-facing surface:** none — this is a one-line documentation change.

## Why

While researching this plan, the legacy PHP codebase (not part of this repo's history — a separate, older system being replaced entirely, not migrated forward) was found to contain multiple dead controller files kept alive by filename suffixes instead of being deleted: `Tryonbkp151025.php`, `Tryonnew25-03.php`, `Webtoolold.php`, `Webtoolold07-05.php`, `Webtoololdnew.php`, `webtoolapi2026-04-28.php`, plus superseded-duplicate pairs like `Adminweb_lower.php`/`Adminweb_shoes.php`. None of that code is being ported — there's no migration task here — but the pattern is worth explicitly guarding against in this repo, since git history already makes it unnecessary.

## Spec

Add one line to the root `CLAUDE.md`'s existing **"Git Commit & Push Policy"** section:

> Never keep a superseded file alive with a suffix/date/"old"/"bkp" in its name. Delete it — git history is the undo button.

Read the existing section first and place the new line so it reads naturally alongside the existing bullet points about when to commit — don't restructure the section, just add this one line.

## Definition of Done

- [ ] The line appears in `CLAUDE.md`'s Git Commit & Push Policy section.
- [ ] No other content in `CLAUDE.md` was changed.

## Report Back

_Codex: fill this in when the phase is complete._

- Confirm the exact diff (should be a single-line addition):

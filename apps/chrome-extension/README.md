# Aivastra Chrome Extension (planned, not yet built)

Shopper-facing virtual try-on, available on any clothing/product page via
heuristic detection — not limited to Ai Vastra-integrated stores. This is a
**new surface**, not a port of the WordPress plugin: the plugin is
server-rendered PHP for a site owner who installed it; this is a Manifest V3
Chrome extension running in a shopper's own browser against arbitrary
third-party pages it does not control.

**Status: planning complete, implementation not started.** This folder holds
the design/process docs only — no extension code exists yet. Work on this
begins only after the current `fixes-wrap/wp-plugin` WordPress plugin branch
is fully pushed and merged; see `docs/PROGRESS.md` in this folder for the
live status.

## Docs in this folder

- **`PLAN.md`** — the full architecture and design: what's reused from the
  existing backend, what's new, why each decision was made the way it was.
  Read this first.
- **`SETUP.md`** — the concrete step-by-step execution checklist to follow
  once implementation starts (backend changes, package scaffold, build
  tooling, Chrome Web Store prep). Written so a session with no prior context
  can pick it up and execute phase by phase.
- **`PROGRESS.md`** — dated, append-only tracking log (same convention as the
  root `docs/progress.md`: newest entry first, Done / Open Questions). Update
  this at the end of every work session on this feature, don't rewrite old
  entries.

## Relationship to the rest of the repo

- Reuses existing backend auth (`/v1/auth/device-login`, `/device-login/google`,
  `/device-refresh`) and the `/v1/dev/tryon` raw-bytes job contract as a
  template — see `PLAN.md` for exact file references.
- Does **not** touch `apps/shopify/`, `apps/shopify-extension/`, or
  `apps/catalogues-web/` — those remain read-only reference/other-surface
  code per this repo's standing rules in the root `CLAUDE.md`.
- Will become a normal `pnpm` workspace package (auto-discovered by
  `pnpm-workspace.yaml`'s `apps/*` glob) once code lands — no registration
  needed beyond adding it to `config/ci-targets.json`'s `separateSurfaces`
  list (see `SETUP.md`).

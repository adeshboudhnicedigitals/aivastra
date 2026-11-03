# Fleet work: how Claude (backend) and Codex (UI) hand off

Two people-sized tracks run in parallel, each in its own worktree and branch:

| Track | Worktree | Branch | Owns (only this side edits it) |
|---|---|---|---|
| Backend, agent, infra (Claude) | `../aivastra-fleet-api` | `feat/fleet-api-read` | `apps/api`, `apps/dispatcher`, `packages/*`, migrations, `scripts/fleet`, `docs/progress.md`, `docs/fleet-contracts`, `docs/fleet-handoff/claude-to-codex.md` |
| Dashboard UI (Codex) | `../aivastra-fleet-ui` | `feat/fleet-ui` | `apps/gpu-ops/**`, `docs/fleet-handoff/codex-to-claude.md` |

Rules

1. **Contract first.** The backend publishes the Zod types in `packages/types` and example JSON in
   `docs/fleet-contracts` *before* the UI builds against an endpoint. A test validates every fixture
   against the real schema.
2. **One writer per file.** Never edit the other side's files. If you need something from them, write it
   in your own hand-off file.
3. **Migrations and `docs/progress.md` are backend-only.**
4. **No commits or pushes by Codex.** Leave changes in the working tree; the backend side reviews and commits.
5. **The API is run from the backend worktree.** The UI side does not start, stop or restart it.
6. **Ports:** API `:4000`, backend-side dashboard `:5180`, UI-side dashboard `:5181`.
7. Backend changes reach the UI branch by `git merge --ff-only feat/fleet-api-read` (or a rebase) run
   from the UI worktree. Tell the backend side first if you have uncommitted work.

Review checklist the backend applies to every UI delivery: typecheck, tests, Biome, parsers accept
real responses from the running API, no zero-for-unknown, no fabricated data in live mode, stale and
403 states handled, accessibility basics, and what was *not* tested stated honestly.

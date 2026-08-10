# Task: implement the Shopify Pricing Page plan, subagent-driven

## Context

Repo: `/mnt/vol1/PycharmProjects/aivastra_v1`
Branch: `feat/shopify-app-store-compliance` (already checked out — do not create a new branch)

Read these three files in full before doing anything:

1. `CLAUDE.md` — authoritative project instructions. Its "Invariants (do not break)" section overrides your defaults.
2. `docs/superpowers/plans/2026-08-10-shopify-pricing-page.md` — the plan you are implementing. 5 tasks.
3. `docs/superpowers/specs/2026-08-10-shopify-pricing-page-design.md` — the design the plan implements. Read it for intent when a task's wording is ambiguous.

## Execution model

Use the `superpowers:subagent-driven-development` skill. Work task-by-task, 1 → 5, in order. For each task N:

1. **Read** the full text of Task N from the plan, including its `**Files:**` and `**Interfaces:**` blocks.
2. **Dispatch a fresh implementer subagent.** Give it: the repo path, the contents of `CLAUDE.md`, the plan's `## Global Constraints` section, and the verbatim text of Task N. Do **not** give it the whole plan — each task is self-contained; the `Interfaces:` block is how it learns what neighbouring tasks produce.
3. The implementer follows the task's checkbox steps **in order** — TDD: write the failing test, run it, confirm it fails for the stated reason, implement, run it, confirm it passes. Implementation-before-test means the task wasn't followed.
4. **Dispatch a fresh reviewer subagent** on the resulting diff (`git diff`). Give it Task N's text and the relevant spec section. It checks every step was actually done, the diff matches the spec's intent (not just the task's letter), tests were genuinely run and passed, and any correctness/quality issue the task text didn't anticipate.
5. If the reviewer raises findings: hand them to an implementer, fix, re-review. Loop until clean.
6. **Commit** using the exact message in that task's commit step. Then move to N+1.

After Task 5, run one final review over the whole branch diff since `18067fdf`.

## Hard rules

- **Never `git push`. Never open a PR.** Commit locally only. If you think the work is ready to push, say so and stop.
- No schema/migration work — this plan touches no DB schema.
- All tests here are plain Vitest unit tests (no DB/Redis/MinIO involved) — `pnpm docker:up` is not required.
- No `console.log` in committed code.
- pnpm workspaces. Never create an npm or yarn lockfile.
- `apps/admin-mobile` is out of scope. Do not touch, test, or typecheck it.
- `planFeatures.ts` (display copy) must stay decoupled from `billing-plans.ts` (credit grants) — no import between them, per the plan's Global Constraints.

## Reporting

After each task, report in three lines: what landed, what the reviewer flagged and how it was resolved, and the exact test command output line showing pass counts.

At the end, report: tasks completed, tasks blocked and why, any step marked unverified, and anything in the plan that turned out wrong once it met the real code. Flag explicitly the plan's open follow-up: confirming Partner Dashboard's actual Pro-plan charge is $229/month is outside this repo and cannot be done by you.

---
name: surface-admin-errors
description: Use when admin-panel operations fail silently or show generic toasts and you must search Grafana to learn the real error. Walks apps/admin-web/src exhaustively, auto-fixes sites that toast but discard the real backend error, and reports fully-silent sites for human review. Trigger words - silent error, generic toast, surface errors, admin error audit, error walkthrough.
---

# Surface Admin Errors

Make every error site in `apps/admin-web/src` show the real backend error, so
Grafana is not needed for routine failures. Deterministic and exhaustive: no
site is silently skipped, no error message is invented.

## Scope (hard boundary)

- Edit `apps/admin-web/src` ONLY.
- NEVER edit `apps/api`, `apps/dispatcher`, `apps/catalogues-web`, or the error
  infra (`apiErrorMessage`, `ApiError`) in `lib/data.ts`.
- If a site's root cause is a backend generic message, note it in the report;
  do not touch backend code.

## Existing infrastructure (reuse — do not reinvent)

In `apps/admin-web/src/lib/data.ts`:
- `apiErrorMessage(err, fallback)` → `err.message` if non-empty, else `fallback`.
- `class ApiError extends Error` → `.message` is the real backend body message
  when present, else a friendly status fallback. Also `.body`, `.code`, `.status`.
- `apiFetch<T>()` throws `ApiError` on non-2xx, network `Error` on fetch failure.

In `components/ToastStack.tsx`: `toast({ kind, title, body })` — `title` bold,
`body` optional second line.

**Canonical fix shape** — keep the friendly title, put the real error in `body`:

```ts
} catch (e) {
  toast({ kind: 'error', title: 'Failed to update face', body: apiErrorMessage(e, 'Please try again.') });
}
```

Backend text wins; the fallback shows only when the error has no message. NEVER
invent an error string.

## Step 1 — Enumerate (the no-miss guarantee)

Run each pattern below (paths are relative to the repo root; each command
targets apps/admin-web/src directly, independent of your current shell's cwd).
Capture the full match list; you will account for every line.

```bash
grep -rEn '[^a-z]catch \{'            --include=*.ts --include=*.tsx apps/admin-web/src   # catch, no binding
grep -rEn '\} catch \('              --include=*.ts --include=*.tsx apps/admin-web/src   # catch, bound
grep -rEn '\.catch\('                --include=*.ts --include=*.tsx apps/admin-web/src   # promise handlers
grep -rEn '!res\.ok|!response\.ok'   --include=*.ts --include=*.tsx apps/admin-web/src   # manual ok checks
grep -rEn 'console\.(error|warn)'    --include=*.ts --include=*.tsx apps/admin-web/src   # logged-only
grep -rEn 'setError\('               --include=*.ts --include=*.tsx apps/admin-web/src   # state, maybe unrendered
```

Build a worklist: one row per unique site (`file:line`). De-dupe overlaps (a
single catch can match more than one pattern — count the site once).

## Step 2 — Classify each site (open the file; read the whole handler)

For each site, read its enclosing handler and assign exactly one class:

| Class | Detected by | Action |
|---|---|---|
| Toasts but drops error | catch has NO binding AND its body contains `toast(` | **AUTO-FIX** |
| Bound but ignores `e` | binding exists, `toast(` call lacks `e`/`apiErrorMessage` | **AUTO-FIX** |
| Logged-only | `console.error/warn` present, no `toast(` in handler | **AUTO-FIX** (add error toast surfacing `e`) |
| Fully silent | catch/handler body has no `toast(` and no `console.*` | **REPORT** |
| Silent non-throw | `if (!res.ok) return` (or `.catch(()=>{})`) with no surface | **REPORT** |
| Already surfaces `e` | `apiErrorMessage`/`e.message`/`err.message` already in a `toast` body | **OK** |

Rules:
- A fully-silent swallow MAY be intentional best-effort (e.g. `AuthContext.tsx`
  initial-auth probe `catch { // not logged in }`, logout `catch { // best-effort }`).
  Do NOT decide — REPORT it, untouched.
- When unsure between AUTO-FIX and REPORT, choose REPORT. Never guess.

## Step 3 — Apply auto-fixes

For each AUTO-FIX site, apply the canonical fix shape:
- If the catch has no binding, add `(e)`.
- Preserve the existing friendly `title` verbatim.
- Add `body: apiErrorMessage(e, '<existing-title-as-sentence or "Please try again.">')`.
- If `apiErrorMessage` is not imported in the file, add it to the existing
  `lib/data.ts` import.
- Logged-only sites: keep the `console.*` line, add the error `toast(...)` after it.

Do NOT change control flow, `finally` blocks, or success paths. Message-surfacing
only.

## Step 4 — Write the report

Write `docs/audits/<YYYY-MM-DD>-admin-error-surfacing.md`:

```markdown
# Admin error-surfacing audit — <YYYY-MM-DD>

## Coverage
N matches = X fixed + Y reported + Z ok

## Auto-fixed (X)
- <file>: <count> site(s)   # one line per file

## Reported for review (Y)
### <file>:<line>
- Current: `<code>`
- Class: Fully silent | Silent non-throw
- Why flagged: <reason>
- Suggested fix: <one line, or "confirm intentional best-effort">
```

## Step 5 — Verify and report coverage

- Run: `pnpm --filter @aivastra/admin build` — must pass. (`apps/admin-web` has
  no dedicated `typecheck` script; `build` runs `tsc -b && vite build`, and
  `tsc -b` performs the full type-check since `noEmit: true` is set in its
  tsconfig — this is the working equivalent for this package.)
- Print the coverage line and confirm the partition balances:
  `N matches = X fixed + Y reported + Z ok`.
- You are NOT done until the build (type-check) passes AND every enumerated
  site is in one bucket AND the tally balances.

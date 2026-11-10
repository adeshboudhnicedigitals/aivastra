# Handoff: AiVastra v1.0 merchant platform (steps 1–2 built, step 3 specified)

Written 2026-11-06 to continue on another machine. Read this first, then `docs/architecture/v1-hld.md`.

## 1. Where things stand

| Step (HLD §10) | State |
|---|---|
| 1 Org model: branches, staff, admin controls | **Built and committed** (`a04f969a`) |
| 2 Devices, in-store sessions, entitlement (credits only) | **Built and committed** (`2247c36d`) |
| 3a Merchant Web foundation | Spec written, **no plan, no code** |
| 3b Merchant Web catalogue | Spec written, no plan, no code |
| 3c Merchant Web dashboards + brand settings | Spec written, no plan, no code |
| 4 Merchant Android, 5 Shopper page + WhatsApp, 6 subscription plug-in, 7 POS | Not started |

Branch `feat/v1-org-model`, cut from `dev` (rebased onto `origin/dev` including PR 665). Local commits:
`c68bb912` HLD + step 1 plan · `a04f969a` step 1 · `2247c36d` step 2.
**At the time of writing the branch was NOT pushed and nothing was merged.** The three step 3 spec
files and this handoff are uncommitted. To continue elsewhere, push the branch first
(`git push -u origin feat/v1-org-model`) after committing the specs/handoff.

## 2. Product decisions (also in HLD §1; the local Claude memory file does not travel)

- No shopper Android app: WhatsApp + mobile web page. One shared AiVastra WhatsApp number and one
  common domain, branded per brand.
- In-store: identify shopper at session start (phone OTP), per-brand consent, no face recognition
  (step 5; step 2 deliberately has no shopper columns).
- Hierarchy: Merchant (owner = the one merchant admin, no `merchant_staff` row) → branches →
  staff (`merchant_staff`, no role column) + many devices per branch. Roles: merchant admin, staff.
- `staff_limit_per_branch` (default 2) per merchant; editable only by AiVastra SUPER_ADMIN. ADMIN
  and SUPER_ADMIN may edit branches/staff/devices (`requireAdmin(['SUPER_ADMIN','ADMIN'])`, same as
  PR 665's agreed price). All changes audited in the same transaction.
- Staff get full brand-wide catalogue edit (soft delete + audit, see 3b).
- Sales: staff "Sold" button now; POS connectors later. Billing hybrid: credits (one merchant
  wallet) or per-device monthly subscription (another developer is building it; `isDeviceCovered`
  in `device/entitlement.ts` is the seam and returns false today). `device_quota_per_month` exists
  but is not enforced.
- **Binding rule from the user: nothing may change behaviour for existing customers; they are
  migrated slowly.** Schema changes additive only; legacy email-login kiosk and existing
  `/v1/merchant/*` routes untouched. This overrides the HLD's "move `/tryon` and redirect": `/tryon`
  stays in `catalogues-web`; 3b copies it.
- Row 2a of the CEO doc (confirm Merchant Android's two faces) was never answered.

## 3. What is in the code

Step 1 (`docs/superpowers/plans/2026-11-06-v1-org-model.md`): tables `merchant_branches`,
`merchant_staff`; `merchants.staff_limit_per_branch / device_quota_per_month / store_url`;
`app.requireMerchantMember` / `requireMerchantAdmin` (`plugins/portal-auth.ts`); `/v1/merchant/org/*`;
`/admin/merchants/:id/org` + branch/staff PATCH; admin-web `MerchantOrgPanel`. Guards: Google
sign-in cannot link onto staff accounts; staff cannot become merchant owners (409).

Step 2 (`docs/superpowers/plans/2026-11-06-v1-devices-sessions-entitlement.md`, spec
`...-design.md`): tables `merchant_devices`, `instore_sessions`, `session_items`; nullable
`jobs.branch_id/device_id/session_id/staff_id`; `app.requireDevice` (`Authorization: Device <token>`);
`/v1/device/*` (pair, me, sessions, items, tryon presign/jobs/job read);
`/v1/merchant/org/devices*` and `/admin/merchants/:id/devices*`; sale void; idle-session sweeper;
`chargeInStoreTryon` (only `=== true` skips the charge); `createGarmentTryonJob` extracted into
`merchant/tryon-job-service.ts` with optional `JobAttribution`.
Migrations: `0255` (step 1), `0256`, `0257` (step 2). **Applied to the local dev DB only**, never to
staging/prod; they ship via push → CI/CD → `db:migrate:prod`. If `dev` has taken those indexes by the
time you merge, renumber per `docs/version-control.md` (the server's index is canonical).

## 4. Resume on a new machine

```bash
git fetch origin && git checkout feat/v1-org-model
cp .env.example .env   # fill secrets; see CLAUDE.md
pnpm install
pnpm docker:up         # postgres + redis + minio on 127.0.0.1
pnpm db:migrate        # applies 0255-0257 to your LOCAL DB
cd apps/api && npx vitest run --config vitest.integration.config.ts device- merchant-org admin-merchant-org merchant-staff-account-guards merchant-me merchant-tryon merchant-quick-tryon unlimited-plan-offer
# expected: 18 files / 138 tests pass (the `device-` pattern also matches older catalog-app-device-* files)
pnpm --filter @aivastra/api test   # unit; was 119 files / 1206 tests
pnpm -r --filter "!@aivastra/admin-mobile" run typecheck && pnpm biome check . --diagnostic-level=error
```

Tooling notes that cost time:
- The pre-commit hook (lefthook + biome) rejects unformatted files. Format a freshly generated
  drizzle snapshot: `npx biome format --write packages/db/src/migrations/meta/<NNNN>_snapshot.json packages/db/src/migrations/meta/_journal.json`.
  Non-null-assertion warnings are expected; only errors block.
- Python is not installed on the original machine; use node or the editor tools for scripted edits.
- Never touch production/staging data or run `db:generate` against them (CLAUDE.md, "Production safety").
- Do not commit or push unless the user asks.

## 5. Process used (how steps 1–2 were run)

superpowers workflow: brainstorming → written spec → writing-plans → subagent-driven development
(fresh implementer + reviewer per task, a final whole-branch review on the most capable model, one
consolidated fix wave, re-review). The scratch ledger and briefs live in `.superpowers/sdd/`, which
is git-ignored and **does not travel**; the committed plans/specs and `docs/progress.md` are the
record. Review findings that mattered and the traps they revealed: cross-merchant branch moves via
inactive rows; account takeover by pre-created verified accounts; a `.catch` that did not cover a
synchronous throw in a money gate (use `=== true` + `try/await`); a vacuous audit test (filter
assertions by resource id); an in-flight device move that mixed session and job branches.

## 6. Next steps (in order)

1. **Ask the user whether to open a PR** for steps 1–2 (not yet pushed or PR'd).
2. Review the three step 3 specs in `docs/superpowers/specs/`:
   `2026-11-06-v1-merchant-web-design.md` (3a, plus decomposition), `...-catalogue-design.md` (3b),
   `...-dashboards-design.md` (3c). Each ends with open questions.
3. Get answers to the 3a questions (domain name; staff password reset path; initial password policy).
4. Write the 3a plan (`superpowers:writing-plans`), then execute with subagent-driven mode.
5. 3b, then 3c, each with its own plan.
6. Then steps 4–7 per the HLD.

## 7. Open decisions to bring up

- Domain for Merchant Web (HLD suggests `merchant.aivastra.com`); needs a CloudPanel vhost and
  possibly Cloudflare rules — out-of-repo state to record in `docs/progress.md`.
- Staff password reset; initial password handling (3a).
- 3b: owner deletes soft or hard; restore of staff-deleted items; may staff trigger paid AI generation.
- 3c: production `jobs` index build strategy (a plain index locks writes; check row count read-only first);
  timezone default; low-credit threshold source.
- Step 2 deferred items (in `docs/progress.md`): jobs FK indexes (do in 3c), sales attributed to a
  deactivated staff member, no re-pair endpoint, `last_seen_at` write on every request, a store NAT
  shares the 200 req/min limit (Android client should poll gently), idempotency helper is check-then-set (pre-existing).
- Nothing in this work was exercised in a browser or on a device; the admin-web `MerchantOrgPanel`
  and all device flows are verified by API tests only.

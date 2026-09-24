# Dashboard "Customize the button" Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, non-blocking "Customize the button" row to the Shopify Dashboard's onboarding checklist, shown once the merchant has confirmed the Try It On theme block is added, pointing them back to the theme editor to change its text/color/position.

**Architecture:** Pure frontend addition to `apps/shopify/src/pages/DashboardPage.tsx`. No new extension, no new API route, no new state — reuses the existing `openThemeEditor()` handler (which calls `GET /v1/shopify/onboarding/theme-editor-url`) and the existing `themeBlockDone` derived value. Rendered conditionally inside the existing "Getting started" `Card`, after the three tracked `StepRow`s, and does not affect `doneCount`/`allDone`/the `ProgressBar` (still `/3`).

**Tech Stack:** React + TypeScript, Shopify Polaris components (`Badge`, `Box`, `BlockStack`, `InlineStack`, `Text`, `Button`).

## Global Constraints

- No new npm dependencies. No backend, schema, or `apps/shopify-extension` changes.
- Polaris components only — this app's design system is Polaris, per `CLAUDE.md`'s dropdown/UI rule for `apps/shopify`.
- `doneCount`, `allDone`, and the `ProgressBar` must keep computing from exactly the original three steps (`synced`, `enabled`, `themeBlockDone`) — this new row must never be counted.
- This app (`apps/shopify`) has no component-render test harness today (no `@testing-library/react`, no jsdom-based tests — only pure-logic unit tests under `src/__tests__` and `src/lib/*.test.ts`). Introducing one for a single conditional JSX block would be disproportionate (YAGNI) and inconsistent with how every other `Page` component in this app is verified. Verification for this task is: `typecheck`, `lint`, `build`, and manual reasoning over the render logic — not a new automated test.

---

### Task 1: Add the conditional "Customize the button" row to DashboardPage

**Files:**
- Modify: `apps/shopify/src/pages/DashboardPage.tsx:370-382` (inside the "Getting started" `Card`'s `BlockStack`, immediately after the third `StepRow` — the "Add the Try It On block to your product page" one — and still inside the `!collapsed` branch)

**Interfaces:**
- Consumes: `themeBlockDone: boolean` (already computed at `DashboardPage.tsx:270`), `openThemeEditor: () => Promise<void>` (already defined at `DashboardPage.tsx:230-241`), `openingEditor: boolean` (already defined at `DashboardPage.tsx:183`). No new state, no new props, no new exports.
- Produces: nothing consumed by other tasks — this is the only task in this plan.

This task has no meaningful "unit under test" in isolation (it's four lines of conditionally-rendered Polaris JSX inside a page component with no test harness), so there is no separate failing-test step — TDD's red/green cycle doesn't apply to markup-only changes in a codebase with no component-render tests. Verification is `typecheck` + `lint` + `build` + manual reasoning, done in Step 2 below.

- [ ] **Step 1: Add the new row's JSX**

Open `apps/shopify/src/pages/DashboardPage.tsx`. Find the third `StepRow` (the theme-block one) and the closing `</BlockStack>`/`)`/`</Card>` that follow it — currently:

```tsx
                <StepRow
                  done={themeBlockDone}
                  title="Add the Try It On block to your product page"
                  description="Required — the try-on button only appears where you place this block. Open the theme editor, drag it directly above the Buy Buttons block, then save."
                >
                  <Button onClick={openThemeEditor} loading={openingEditor}>
                    Open theme editor
                  </Button>
                  <Button variant="primary" onClick={confirmThemeBlock} loading={confirming}>
                    I've added it
                  </Button>
                </StepRow>
              </BlockStack>
            )}
```

Replace it with (adds the new conditional block right after the existing `StepRow`, still inside the same `BlockStack` and still inside the `!collapsed` branch):

```tsx
                <StepRow
                  done={themeBlockDone}
                  title="Add the Try It On block to your product page"
                  description="Required — the try-on button only appears where you place this block. Open the theme editor, drag it directly above the Buy Buttons block, then save."
                >
                  <Button onClick={openThemeEditor} loading={openingEditor}>
                    Open theme editor
                  </Button>
                  <Button variant="primary" onClick={confirmThemeBlock} loading={confirming}>
                    I've added it
                  </Button>
                </StepRow>
                {themeBlockDone && (
                  // Informational, not a checklist item: customizing a block that
                  // doesn't exist yet is meaningless, so this only appears once
                  // themeBlockDone is true. Deliberately excluded from
                  // doneCount/allDone/ProgressBar above — it's optional, not part
                  // of the 3-step "getting started" completion criteria.
                  <Box paddingBlockStart="200">
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start" gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="info">Optional</Badge>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Customize the button
                          </Text>
                        </InlineStack>
                        <Button onClick={openThemeEditor} loading={openingEditor}>
                          Open theme editor
                        </Button>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        Change the button's text, colors, promo message, or position by clicking
                        the block in the theme editor — that's where its settings live.
                      </Text>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            )}
```

No new imports are needed — `Badge`, `Box`, `BlockStack`, `InlineStack`, `Text`, and `Button` are already imported at the top of the file (`DashboardPage.tsx:1-16`).

- [ ] **Step 2: Typecheck, lint, and build**

Run from the repo root:

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```

Expected: all three exit 0 with no errors. (Package name is `@aivastra/shopify-admin` per `apps/shopify/package.json:2` — the directory is `apps/shopify` but the pnpm filter must use the package name.)

- [ ] **Step 3: Manually verify the render logic**

There is no automated test for this (see Global Constraints), so verify by reasoning through the four states `doneCount`/`themeBlockDone` can be in, using the existing code paths:

1. `themeBlockDone === false` (fresh install, nothing confirmed yet): the new `Box` block does not render — only the three original `StepRow`s show, exactly as today. Confirm this by checking the JSX condition `{themeBlockDone && (...)}` short-circuits to `false`.
2. `themeBlockDone === true` and the checklist is expanded (`collapsed === false`, e.g. because `synced` or `enabled` is still false, or the merchant clicked "Show steps"): the new "Customize the button" block renders directly under the third `StepRow`, inside the same bordered `BlockStack`.
3. `themeBlockDone === true` and `allDone === true` (all 3 steps done, `expanded === false`): the whole `!collapsed` branch is skipped (renders the "All set" success text instead, per the existing `collapsed ? (...) : (...)` ternary at `DashboardPage.tsx:346`) — so the new row correctly does not render in the collapsed state either, matching the behavior of the three original `StepRow`s.
4. Confirm `doneCount` (`DashboardPage.tsx:271`) and the `ProgressBar`'s `progress={(doneCount / 3) * 100}` (`DashboardPage.tsx:336`) are untouched by this change — they still only read `synced`, `enabled`, `themeBlockDone`, none of which this task modifies.

If you have a Shopify development store with this app installed, you can additionally load the embedded admin at `/shopify-admin` and click through the "Getting started" card after confirming the theme block, to see the new row live. This is optional given point 1 in Global Constraints (no existing Dashboard change in this app has been verified this way either) — the reasoning check above is sufficient to merge.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/pages/DashboardPage.tsx
git commit -m "$(cat <<'EOF'
feat(shopify): add optional customize-button step to onboarding checklist

Points merchants back to the theme editor to change the Try It On
block's text/color/position once it's confirmed added — settings only
live in the block's own theme-editor panel, so there's nothing to
mirror into the app UI.
EOF
)"
```

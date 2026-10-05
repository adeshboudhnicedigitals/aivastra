-- Stores installed before the onboarding wizard reached production never set
-- settings.onboardingCompletedOnce (only the wizard writes it), so the SPA's
-- hard gate (apps/shopify/src/App.tsx) traps them on /onboarding/products:
-- getOnboardingStep() derives "products" for any store without live synced
-- product rows, and that page's on-arrival import finds nothing to show.
-- Latch the flag for those stores so they land on the Dashboard instead.
--
-- Cutoff 2026-09-30T15:27+05:30: the wizard reached production in PR #431 (the
-- deploy finished ~15:27 IST that day; the earlier 09-24/09-28 commit dates are
-- dev dates). Any store created after it went through the real wizard and is
-- left alone, including one that is mid-onboarding right now. A production audit
-- (2026-10-05) found no installed store created between 2026-09-24 and
-- 2026-10-03, so this selects the same 34 stores as any earlier cutoff would.
UPDATE "shopify_stores"
SET "settings" = "settings" || '{"onboardingCompletedOnce": true}'::jsonb,
    "updated_at" = now()
WHERE "uninstalled_at" IS NULL
  AND "created_at" < '2026-09-30T15:27:00+05:30'
  AND COALESCE("settings" ->> 'onboardingCompletedOnce', 'false') <> 'true';

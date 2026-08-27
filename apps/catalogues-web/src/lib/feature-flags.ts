// Google OAuth consent screen is currently unverified (Testing mode) — Drive
// connect/export fails with access_denied for anyone not allow-listed as a
// test user. Flip to true and redeploy once Google verification clears.
export const GOOGLE_DRIVE_ENABLED = false;

// Regenerate is still being finalized (prompt-pool tuning, limit UX). Hides
// the button/CTA and its reason/limit modals in the UI only — backend routes
// and logic are untouched. Flip to true once the feature is ready to ship.
export const REGENERATE_ENABLED = false;

// Google OAuth consent screen is currently unverified (Testing mode) — Drive
// connect/export fails with access_denied for anyone not allow-listed as a
// test user. Flip to true and redeploy once Google verification clears.
export const GOOGLE_DRIVE_ENABLED = false;

// Regenerate: default reasons + per-reason prompt fallback are in place, so
// the button/CTA and its reason/limit modals are live. Flip to false to hide
// them again without touching any other regenerate logic.
export const REGENERATE_ENABLED = true;

// Refund requests: the "Request refund" button, modal and status chip on completed
// results. Always on; the API and admin page ship with it. Set to false only as a kill
// switch to hide the button without touching the refund logic.
export const REFUND_REQUEST_ENABLED = true;

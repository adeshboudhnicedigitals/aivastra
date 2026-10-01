-- Custom SQL migration file, put your code below! --

-- apps/dispatcher/src/workflow/patcher.ts now caps a template's resolved
-- output/latent dims to latent_max_px/output_max_px instead of ignoring them.
-- Every template still sitting at the untouched NOT NULL DEFAULT 2048 (almost
-- all of them — verified against prod: 71 of 76 active dual-size-group rows)
-- would silently render smaller than today, since ASPECT_DIMENSIONS resolves
-- up to a 2688px long edge. Raise the untouched default to 4096 — safely above
-- any current ASPECT_DIMENSIONS value and above every admin-customized value
-- seen in prod (max 2688) — so only a template an admin has actually lowered
-- on purpose (e.g. lehanga170926_api at 2560/2560) changes behavior. The
-- WHERE clause matches both columns still at 2048 so any row with even one
-- customized column is left untouched, including asymmetric overrides.
UPDATE "workflow_templates"
SET "latent_max_px" = 4096, "output_max_px" = 4096
WHERE "latent_max_px" = 2048 AND "output_max_px" = 2048;

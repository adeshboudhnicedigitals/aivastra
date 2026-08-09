-- 0146_jobs_batch_id.sql added jobs.batch_id as a bare grouping UUID (see
-- createBatch.ts: "there is no batches table" — progress is derived via
-- GROUP BY batch_id, nothing ever writes a row for it elsewhere). Staging
-- was separately found with a "jobs_batch_id_fkey" FK to a "tryon_batches"
-- table that appears nowhere in this repo's migration history — leftover
-- from an earlier, abandoned design, added directly to the DB outside the
-- normal migration path. It rejects every batch job insert with a foreign
-- key violation. This drops it (and the orphaned table, if present)
-- idempotently, so it's a no-op anywhere the drift never happened.
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_batch_id_fkey";--> statement-breakpoint
DROP TABLE IF EXISTS "tryon_batches";

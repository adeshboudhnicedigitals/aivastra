-- Applied to the staging database immediately after restoring a production dump.
--
-- The dump carries production's `workers` rows, which point at the live ComfyUI
-- GPUs behind Cloudflare tunnels. Left in place, the staging dispatcher would
-- select one and occupy a GPU a paying customer is waiting on. Emptying the table
-- is the whole point of this file.
--
-- No rows are added back. Staging has no GPU of its own yet, so jobs enqueue, the
-- dispatcher finds no healthy worker, and they stay QUEUED — which still exercises
-- auth, credit deduction, catalog resolution, the job row, the stream write and the
-- SSE connection. When a dedicated staging ComfyUI box exists, register it through
-- the admin panel and add a row for it here so it survives the next sync.
--
-- The dispatcher loads this table into the Redis worker registry at boot, so the
-- sync script restarts it after applying this.

BEGIN;

DELETE FROM workers;

COMMIT;

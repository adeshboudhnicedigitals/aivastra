-- Remove duplicate (job_id, reason) rows before creating the unique index.
-- Keeps the row with the lowest id (earliest insert) and deletes the rest.
DELETE FROM "credit_ledger"
WHERE "job_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "credit_ledger"
    WHERE "job_id" IS NOT NULL
    GROUP BY "job_id", "reason"
  );

CREATE UNIQUE INDEX "credit_ledger_job_reason_uniq"
  ON "credit_ledger" ("job_id", "reason")
  WHERE "job_id" IS NOT NULL;

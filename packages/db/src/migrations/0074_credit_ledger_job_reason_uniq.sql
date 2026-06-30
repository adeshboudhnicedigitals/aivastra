CREATE UNIQUE INDEX "credit_ledger_job_reason_uniq"
  ON "credit_ledger" ("job_id", "reason")
  WHERE "job_id" IS NOT NULL;

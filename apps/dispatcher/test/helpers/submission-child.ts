import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { submitRecordedPhase } from '../../src/job/submission.js';

const databaseUrl = process.env.SUBMISSION_TEST_DATABASE_URL;
const jobId = process.env.SUBMISSION_TEST_JOB_ID;
const workerUrl = process.env.SUBMISSION_TEST_WORKER_URL;
if (!databaseUrl || !jobId || !workerUrl) throw new Error('missing isolated child fixture config');
const { db } = createDb(databaseUrl);
process.send?.({ ready: true });
const receipt = await submitRecordedPhase({
  db,
  jobId,
  phase: 'main',
  worker: { id: 'signal-fixture', url: workerUrl, apiKey: 'fixture' },
  prompt: { '1': { class_type: 'Fixture', inputs: {} } },
  contract: { kind: 'signal-fixture' },
  log: createLogger('submission-child'),
});
process.send?.({ receipt });
// Stay alive for a real signal after receipt persistence, without a test-only
// branch in the production submission helper.
await new Promise(() => {});

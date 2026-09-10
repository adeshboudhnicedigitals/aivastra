import { schema } from '@aivastra/db';
import { sql } from 'drizzle-orm';

// Generation duration = completedAt - startedAt, in whole seconds. NULL for any
// job missing either timestamp (queued/in-flight jobs), which naturally drops
// out of a >=/<= range comparison rather than needing an explicit NULL guard.
export function jobDurationSecondsSql() {
  return sql<
    number | null
  >`EXTRACT(EPOCH FROM (${schema.jobs.completedAt} - ${schema.jobs.startedAt}))`;
}

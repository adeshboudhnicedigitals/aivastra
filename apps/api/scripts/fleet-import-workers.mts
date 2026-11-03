// LOCAL DEV ONLY. Reads a JSON array of worker rows on stdin and upserts them into the LOCAL
// database, so the local dashboard and dispatcher see the same workers as production. Keys are
// written to the local database and never printed. Refuses to run against a non-local database.
//
//   echo "select json_agg(w) from (select id,label,url,api_key,is_active,allowed_job_types \
//         from workers where id in ('worker-1',...)) w;" \
//     | ssh vps "docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' \
//         aivastra-prod-postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At'" \
//     | pnpm --filter @aivastra/api exec tsx --env-file=../../.env scripts/fleet-import-workers.mts
import { createDb, schema } from '@aivastra/db';
import { z } from 'zod';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)([:/]|$)/.test(DATABASE_URL)) {
  console.error('refusing to run: DATABASE_URL must point at this machine');
  process.exit(1);
}

const rowSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  url: z.string().url(),
  api_key: z.string().min(8),
  is_active: z.boolean(),
  allowed_job_types: z.array(z.string()),
});

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const rows = z.array(rowSchema).parse(JSON.parse(raw));

const { db, close } = createDb(DATABASE_URL);
for (const r of rows) {
  await db
    .insert(schema.workers)
    .values({
      id: r.id,
      label: r.label,
      url: r.url,
      apiKey: r.api_key,
      isActive: r.is_active,
      allowedJobTypes: r.allowed_job_types,
    })
    .onConflictDoUpdate({
      target: schema.workers.id,
      set: {
        label: r.label,
        url: r.url,
        apiKey: r.api_key,
        isActive: r.is_active,
        allowedJobTypes: r.allowed_job_types,
        updatedAt: new Date(),
      },
    });
  console.log(
    `${r.id}: ${r.url} active=${r.is_active} types=${r.allowed_job_types.join(',')} key=<${r.api_key.length} chars>`,
  );
}
await close();
process.exit(0);

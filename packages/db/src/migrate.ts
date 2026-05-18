import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const url = process.env.DATABASE_URL!;
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: './src/migrations' });
await client.end();
console.log('migrations applied');

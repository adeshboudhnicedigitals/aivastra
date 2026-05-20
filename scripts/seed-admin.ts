import postgres from 'postgres';
import { hash, Algorithm } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.DATABASE_URL;
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL;
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!DB_URL || !EMAIL || !PASSWORD) {
  console.error('Required: DATABASE_URL, ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD');
  process.exit(1);
}

void (async () => {
  const sql = postgres(DB_URL!);

  const passwordHash = await hash(PASSWORD!, {
    algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1,
  });

  const existing = await sql`SELECT id FROM users WHERE email = ${EMAIL!}`;
  let userId: string;
  if (existing.length) {
    userId = existing[0].id as string;
    console.log('user exists:', userId);
  } else {
    const [u] = await sql`
      INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
      VALUES (${randomUUID()}, ${EMAIL!}, ${passwordHash}, ${'Admin'}, NOW(), NOW())
      RETURNING id
    `;
    userId = u.id as string;
    await sql`INSERT INTO user_credits (user_id, balance) VALUES (${userId}, 0)`;
    console.log('user created:', userId);
  }

  const existingAdmin = await sql`SELECT user_id FROM admin_users WHERE user_id = ${userId}`;
  if (existingAdmin.length) {
    console.log('already admin — done');
  } else {
    await sql`INSERT INTO admin_users (user_id, role) VALUES (${userId}, 'SUPER_ADMIN')`;
    console.log('admin_users row inserted');
  }

  console.log(`\nAdmin ready:\n  email:    ${EMAIL}\n  password: ${PASSWORD}\n  role:     SUPER_ADMIN`);
  await sql.end();
})();

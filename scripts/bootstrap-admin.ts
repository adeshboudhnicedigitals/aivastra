import { createDb, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../apps/api/src/modules/auth/service';

const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!email || !password) {
  console.log('no bootstrap admin env; skipping');
  process.exit(0);
}
const { db, close } = createDb(process.env.DATABASE_URL!);

const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
let userId = existing?.id;
if (!existing) {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning();
  await db.insert(schema.userCredits).values({ userId: u.id, balance: 0 });
  userId = u.id;
}
const [adm] = await db
  .select()
  .from(schema.adminUsers)
  .where(eq(schema.adminUsers.userId, userId!));
if (!adm) await db.insert(schema.adminUsers).values({ userId: userId!, role: 'SUPER_ADMIN' });
await close();
console.log('admin bootstrap complete:', email);

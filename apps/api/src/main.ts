import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { loadEnv } from './env.js';
import { hashPassword } from './modules/auth/service.js';
import { startCollectionResyncScheduler } from './modules/shopify/collections-resync-scheduler.js';
import { startSyncConsumer } from './modules/shopify/sync-consumer.js';
import { buildServer } from './server.js';

const env = loadEnv();
const app = await buildServer(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

startSyncConsumer(app);
startCollectionResyncScheduler(app);

if (env.ADMIN_BOOTSTRAP_EMAIL && env.ADMIN_BOOTSTRAP_PASSWORD) {
  const [existing] = await app.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, env.ADMIN_BOOTSTRAP_EMAIL));
  if (!existing) {
    const passwordHash = await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD);
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: env.ADMIN_BOOTSTRAP_EMAIL,
        passwordHash,
        displayName: 'Admin',
        tier: 'free',
        emailVerified: true,
      })
      .returning();
    await app.db.insert(schema.adminUsers).values({ userId: user.id, role: 'SUPER_ADMIN' });
    app.log.info({ email: env.ADMIN_BOOTSTRAP_EMAIL }, 'bootstrap admin created');
  } else {
    const [adminRow] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, existing.id));
    if (!adminRow) {
      await app.db.insert(schema.adminUsers).values({ userId: existing.id, role: 'SUPER_ADMIN' });
      app.log.info({ email: env.ADMIN_BOOTSTRAP_EMAIL }, 'bootstrap admin elevated');
    }
  }
}

import { setDefaultResultOrder } from 'node:dns';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { loadEnv } from './env.js';
import { hashPassword } from './modules/auth/service.js';
import { startComparisonCollector } from './modules/comparison/collector.js';
import { startComparisonDispatcher } from './modules/comparison/dispatcher-tick.js';
import { startComparisonRetention } from './modules/comparison/retention.js';
import { startUserLowCreditAlertScheduler } from './modules/credits/low-credit-alert-scheduler.js';
import { startUnlimitedPlanReminderScheduler } from './modules/credits/unlimited-plan-scheduler.js';
import {
  createAppWhatsappClient,
  startWhatsappDelivery,
  startWhatsappInboundConsumer,
} from './modules/messaging/inbound-consumer.js';
import { startRecognitionSweeper } from './modules/messaging/recognition-sweeper.js';
import { startAlertScheduler } from './modules/shopify/alert-scheduler.js';
import { startAutorefillReconciler } from './modules/shopify/autorefill-reconciler.js';
import { startCollectionResyncScheduler } from './modules/shopify/collections-resync-scheduler.js';
import { startRedactionRetryScheduler } from './modules/shopify/gdpr-retry-scheduler.js';
import { startPaymentSettlementScheduler } from './modules/shopify/payment-settlement-scheduler.js';
import { startProductResyncScheduler } from './modules/shopify/products-resync-scheduler.js';
import { startSyncConsumer } from './modules/shopify/sync-consumer.js';
import { startWebhookRegistrationReconciler } from './modules/shopify/webhook-registration-reconciler.js';
import { startUploadSweeper } from './modules/uploads/sweeper.js';
import { buildServer } from './server.js';

// Containers here have no IPv6 route, but external hosts we call (Shopify's
// Fastly edge, R2/MinIO) resolve AAAA. Node's Happy-Eyeballs default races
// both families with only ~250ms before falling back to IPv4 — a window a
// dead IPv6 attempt can occasionally lose outright, surfacing as a spurious
// ETIMEDOUT on an otherwise-healthy outbound call. Forcing IPv4-first removes
// the race instead of racing a leg that can never win.
setDefaultResultOrder('ipv4first');

const env = loadEnv();
const app = await buildServer(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

startSyncConsumer(app);
startCollectionResyncScheduler(app);
startProductResyncScheduler(app);
startUploadSweeper(app);
startRecognitionSweeper(app);
const stopComparisonCollector = startComparisonCollector(app);
const stopComparisonDispatcher = startComparisonDispatcher(app);
const stopComparisonRetention = startComparisonRetention(app);
app.addHook('onClose', async () => {
  stopComparisonCollector();
  stopComparisonDispatcher();
  stopComparisonRetention();
});
startAlertScheduler(app);
startAutorefillReconciler(app);
startPaymentSettlementScheduler(app);
startRedactionRetryScheduler(app);
startWebhookRegistrationReconciler(app);
startUserLowCreditAlertScheduler(app);
startUnlimitedPlanReminderScheduler(app);

// WhatsApp catalog bot (plan 3). Started only when enabled AND fully configured,
// so a half-configured environment logs once instead of failing on every message.
if (app.env.MESSAGING_WHATSAPP_ENABLED === true) {
  const wa = createAppWhatsappClient(app);
  if (wa) {
    startWhatsappInboundConsumer(app, wa);
    startWhatsappDelivery(app, wa);
  } else {
    app.log.warn(
      'MESSAGING_WHATSAPP_ENABLED is on but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are missing — bot not started',
    );
  }
}

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
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: user.id, role: 'SUPER_ADMIN', passwordHash });
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

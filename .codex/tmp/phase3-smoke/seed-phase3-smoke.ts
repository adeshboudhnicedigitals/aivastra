import { hashPassword } from 'file:///D:/aivastra/webtool/apps/api/src/modules/auth/service.ts';
import { createDb, eq, schema } from 'file:///D:/aivastra/webtool/packages/db/src/index.ts';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

async function main() {
  const EMAIL = 'phase3-kiosk-smoke@aivastra.test';
  const PASSWORD = 'Phase3Smoke!234';
  const CLIENT_NAME = 'Phase 3 Kiosk Smoke Merchant';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAW0lEQVR4nO3PQQ3AIADAQMC/5yFjRxMFfXpn5i8AAAAAAOBzvAEAAAAAAIBvDwAAAAAAwLcHAAAAAADAtwcAAAAAAMC3BwAAAAAAwLcHAAAAAADAtwcAAAAAAMD3B3MeAc8D5J4MAAAAAElFTkSuQmCC',
    'base64',
  );

  const required = [
    'DATABASE_URL',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }

  const { db, close } = createDb(process.env.DATABASE_URL);
  const s3 = new S3Client({
    endpoint: process.env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: String(process.env.R2_FORCE_PATH_STYLE ?? 'true') !== 'false',
  });

  try {
    const passwordHash = await hashPassword(PASSWORD);
    const existing = await db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.email, EMAIL))
      .limit(1);
    let client = existing[0];
    if (client) {
      const updated = await db
        .update(schema.widgetClients)
        .set({
          companyName: CLIENT_NAME,
          contactName: 'Phase 3 Smoke',
          phone: '+15555550123',
          websiteUrl: 'https://phase3-smoke.aivastra.test',
          companySize: '1-10',
          purpose: 'kiosk smoke test',
          businessAddress: 'Smoke Test',
          passwordHash,
          isActive: true,
          kioskEnabled: true,
          maxKioskDevices: 20,
          allowedOrigins: ['http://localhost:3002'],
          updatedAt: new Date(),
        })
        .where(eq(schema.widgetClients.id, client.id))
        .returning();
      client = updated[0];
    } else {
      const inserted = await db
        .insert(schema.widgetClients)
        .values({
          companyName: CLIENT_NAME,
          contactName: 'Phase 3 Smoke',
          email: EMAIL,
          phone: '+15555550123',
          websiteUrl: 'https://phase3-smoke.aivastra.test',
          companySize: '1-10',
          purpose: 'kiosk smoke test',
          businessAddress: 'Smoke Test',
          passwordHash,
          isActive: true,
          kioskEnabled: true,
          maxKioskDevices: 20,
          allowedOrigins: ['http://localhost:3002'],
          settings: {},
        })
        .returning();
      client = inserted[0];
    }

    await db
      .insert(schema.widgetClientCredits)
      .values({ widgetClientId: client.id, balance: 500 })
      .onConflictDoUpdate({
        target: schema.widgetClientCredits.widgetClientId,
        set: { balance: 500, updatedAt: new Date() },
      });

    const catalogKey = `merchant-catalog/${client.id}/phase3-smoke-garment.png`;
    const thumbKey = `merchant-catalog/${client.id}/phase3-smoke-thumb.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: catalogKey,
        Body: png,
        ContentType: 'image/png',
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: thumbKey,
        Body: png,
        ContentType: 'image/png',
      }),
    );

    const existingItems = await db
      .select()
      .from(schema.merchantCatalogItems)
      .where(eq(schema.merchantCatalogItems.widgetClientId, client.id));
    const smokeItem = existingItems.find((item) => item.sku === 'PHASE3-SMOKE-001');
    if (smokeItem) {
      await db
        .update(schema.merchantCatalogItems)
        .set({
          label: 'Smoke Test Saree',
          sku: 'PHASE3-SMOKE-001',
          gender: 'women',
          category: 'Sarees',
          r2Key: catalogKey,
          thumbnailKey: thumbKey,
          isActive: true,
          moderationStatus: 'approved',
          sortOrder: -100,
          updatedAt: new Date(),
        })
        .where(eq(schema.merchantCatalogItems.id, smokeItem.id));
    } else {
      await db.insert(schema.merchantCatalogItems).values({
        widgetClientId: client.id,
        label: 'Smoke Test Saree',
        sku: 'PHASE3-SMOKE-001',
        gender: 'women',
        category: 'Sarees',
        r2Key: catalogKey,
        thumbnailKey: thumbKey,
        isActive: true,
        moderationStatus: 'approved',
        sortOrder: -100,
      });
    }

    const jsonContent = {
      '31': { inputs: { image: '' } },
      '139': { inputs: { image: '' } },
      '134': { inputs: {} },
    };
    const existingTemplate = await db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.slug, 'phase3-smoke-widget'))
      .limit(1);
    const templateValues = {
      slug: 'phase3-smoke-widget',
      label: 'Phase 3 Smoke Widget Workflow',
      jsonContent,
      faceNodeId: 'unused-face',
      poseNodeId: 'unused-pose',
      bgNodeId: 'unused-bg',
      upperNodeIds: ['31'],
      facePhasePromptNode: 'unused-face-prompt',
      garmentPhasePromptNode: 'unused-garment-prompt',
      workflowType: 'widget',
      widgetGarmentNodeId: '31',
      widgetCustomerPhotoNodeId: '139',
      widgetOutputNodeId: '134',
      isActive: true,
      updatedAt: new Date(),
    };
    if (existingTemplate[0]) {
      await db
        .update(schema.workflowTemplates)
        .set(templateValues)
        .where(eq(schema.workflowTemplates.id, existingTemplate[0].id));
    } else {
      await db.insert(schema.workflowTemplates).values(templateValues);
    }

    console.log(
      JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        widgetClientId: client.id,
        catalogKey,
        thumbKey,
      }),
    );
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

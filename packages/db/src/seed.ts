import { faker } from '@faker-js/faker';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDb } from './index.js';
import * as schema from './schema/index.js';

// Deterministic seed for reproducible data
faker.seed(12345);

// Matches apps/api/src/modules/auth/service.ts's ARGON so the seeded admin
// can actually log in through the normal auth flow.
const ARGON: Parameters<typeof hash>[1] = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DEV_ADMIN_EMAIL = 'admin@aivastra.dev';
const DEV_ADMIN_PASSWORD = 'dev-admin-password';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to seed the database');
    process.exit(1);
  }

  const { db, close } = createDb(url);
  console.log('🌱 Seeding database with dummy data...');

  try {
    // 1. Users
    console.log('Seeding users (100)...');
    const newUsers = Array.from({ length: 100 }).map(() => ({
      email: `${faker.internet.email()}_${faker.string.uuid()}`,
      displayName: faker.person.fullName(),
      tier: faker.helpers.arrayElement(['free', 'starter', 'growth', 'pro']),
      emailVerified: true,
    }));
    await db.insert(schema.users).values(newUsers).onConflictDoNothing();

    // 2. Catalog Types
    console.log('Ensuring catalog types...');
    const typesToInsert = [
      { slug: 'models', label: 'Models' },
      { slug: 'garments', label: 'Garments' },
      { slug: 'backgrounds', label: 'Backgrounds' },
    ];
    await db.insert(schema.catalogTypes).values(typesToInsert).onConflictDoNothing();
    const dbTypes = await db.select().from(schema.catalogTypes);

    // 3. Categories and Items
    if (dbTypes.length > 0) {
      const modelsType = dbTypes.find((t) => t.slug === 'models') ?? dbTypes[0];

      console.log('Seeding catalog categories (20)...');
      const categories = Array.from({ length: 20 }).map(() => ({
        typeId: modelsType.id,
        slug: `${faker.lorem.slug()}-${faker.string.uuid().slice(0, 8)}`,
        label: faker.commerce.department(),
      }));
      const insertedCategories = await db
        .insert(schema.catalogCategories)
        .values(categories)
        .returning({ id: schema.catalogCategories.id });

      if (insertedCategories.length > 0) {
        console.log('Seeding catalog items (2000)...');
        const items = Array.from({ length: 2000 }).map(() => ({
          categoryId: faker.helpers.arrayElement(insertedCategories).id,
          type: faker.helpers.arrayElement(['lower', 'shoe']),
          label: faker.commerce.productName(),
          r2Key: `catalog/${faker.string.uuid()}.png`,
          thumbnailKey: `catalog/thumbs/${faker.string.uuid()}.png`,
        }));

        // Insert in chunks to avoid parameter limits (Postgres max 65535 parameters)
        for (let i = 0; i < items.length; i += 500) {
          await db.insert(schema.catalogItems).values(items.slice(i, i + 500));
        }
      }
    }

    // 4. Dev admin user
    console.log('Seeding dev admin user...');
    const passwordHash = await hash(DEV_ADMIN_PASSWORD, ARGON);
    const [adminUser] = await db
      .insert(schema.users)
      .values({
        email: DEV_ADMIN_EMAIL,
        displayName: 'Dev Admin',
        tier: 'pro',
        emailVerified: true,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { passwordHash },
      })
      .returning({ id: schema.users.id });
    await db
      .insert(schema.adminUsers)
      .values({ userId: adminUser.id, role: 'SUPER_ADMIN', status: 'active', passwordHash })
      .onConflictDoUpdate({
        target: schema.adminUsers.userId,
        set: { status: 'active', passwordHash },
      });
    console.log(`   → login with ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`);

    // 5. Minimal workflow template (no real ComfyUI jsonContent is available in-repo —
    // this only unblocks pose/model FK requirements for local dev, not real job dispatch)
    console.log('Seeding minimal workflow template...');
    await db
      .insert(schema.workflowTemplates)
      .values({
        slug: 'dev-seed-template',
        label: 'Dev Seed Template',
        jsonContent: {},
        poseNodeId: 'pose',
        upperNodeIds: [],
        garmentPhasePromptNode: 'garment',
        workflowType: 'tryon',
        isActive: true,
      })
      .onConflictDoNothing({ target: schema.workflowTemplates.slug });

    console.log('✅ Seeding complete!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await close();
  }
}

main();

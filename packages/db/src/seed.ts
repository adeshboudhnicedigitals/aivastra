import { faker } from '@faker-js/faker';
import { createDb } from './index.js';
import * as schema from './schema/index.js';

// Deterministic seed for reproducible data
faker.seed(12345);

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
      tier: faker.helpers.arrayElement(['free', 'starter', 'growth', 'business']),
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

    console.log('✅ Seeding complete!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await close();
  }
}

main();

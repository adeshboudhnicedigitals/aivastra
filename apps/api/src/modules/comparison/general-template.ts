import { type DB, type DbTransaction, schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';

export async function resolveGeneralTemplate(
  db: DB | DbTransaction,
  lock = false,
): Promise<{ templateId: string; version: number } | null> {
  const query = db
    .select({ templateId: schema.workflowTemplates.id, version: schema.workflowTemplates.version })
    .from(schema.tryonCategories)
    .innerJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.tryonCategories.slug, 'general'),
        eq(schema.tryonCategories.isActive, true),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  const [template] = await (lock ? query.for('update') : query);
  return template ?? null;
}

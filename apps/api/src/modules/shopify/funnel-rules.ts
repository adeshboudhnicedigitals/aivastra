import { schema } from '@aivastra/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface ProductAttributes {
  productType: string | null;
  tags: string[] | null;
  vendor: string | null;
  collections: string[] | null;
}

export function matchesConditions(
  product: ProductAttributes,
  conditions: schema.FunnelRuleCondition[],
): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((cond) => {
    if (cond.field === 'tags') {
      return (product.tags ?? []).includes(cond.value);
    }
    if (cond.field === 'collections') {
      return (product.collections ?? []).includes(cond.value);
    }
    const fieldValue = cond.field === 'product_type' ? product.productType : product.vendor;
    if (fieldValue == null) return false;
    if (cond.operator === 'equals') return fieldValue === cond.value;
    return fieldValue.toLowerCase().includes(cond.value.toLowerCase());
  });
}

export async function resolveFunnelTemplateId(
  app: FastifyInstance,
  storeId: string,
  product: ProductAttributes,
): Promise<string | null> {
  const rules = await app.db
    .select()
    .from(schema.shopifyFunnelRules)
    .where(
      and(
        eq(schema.shopifyFunnelRules.storeId, storeId),
        eq(schema.shopifyFunnelRules.mode, 'automated'),
      ),
    )
    .orderBy(asc(schema.shopifyFunnelRules.priority));

  for (const rule of rules) {
    if (matchesConditions(product, rule.conditions)) return rule.funnelTemplateId;
  }
  return null;
}

export async function assignFunnelFromRules(
  app: FastifyInstance,
  garmentRowId: string,
  storeId: string,
  product: ProductAttributes,
): Promise<void> {
  const funnelTemplateId = await resolveFunnelTemplateId(app, storeId, product);
  await app.db
    .update(schema.shopifyProductGarments)
    .set({
      funnelTemplateId,
      funnelAssignmentSource: funnelTemplateId ? 'automated' : null,
    })
    .where(eq(schema.shopifyProductGarments.id, garmentRowId));
}

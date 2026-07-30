import { schema } from '@aivastra/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface ProductAttributes {
  productType: string | null;
  tags: string[] | null;
  vendor: string | null;
  collections: string[] | null;
}

/** Rule values are typed by hand in the funnel setup UI; Shopify's own casing and
 *  padding are whatever the merchant's catalog happens to use. Comparing raw meant
 *  a rule reading `tags contains "upper"` never matched the tag `Upper Garment`. */
function norm(value: string): string {
  return value.trim().toLowerCase();
}

function matchesOne(fieldValue: string, cond: schema.FunnelRuleCondition): boolean {
  return cond.operator === 'equals'
    ? norm(fieldValue) === norm(cond.value)
    : norm(fieldValue).includes(norm(cond.value));
}

export function matchesConditions(
  product: ProductAttributes,
  conditions: schema.FunnelRuleCondition[],
): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((cond) => {
    // Array fields match if ANY element satisfies the condition. `equals` compares
    // the whole tag/title, `contains` a substring of it — previously both collapsed
    // to an exact case-sensitive Array.includes, so `contains` was inert here.
    if (cond.field === 'tags' || cond.field === 'collections') {
      const values = (cond.field === 'tags' ? product.tags : product.collections) ?? [];
      return values.some((v) => matchesOne(v, cond));
    }
    const fieldValue = cond.field === 'product_type' ? product.productType : product.vendor;
    if (fieldValue == null) return false;
    return matchesOne(fieldValue, cond);
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

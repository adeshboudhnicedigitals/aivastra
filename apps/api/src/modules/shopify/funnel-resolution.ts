import { schema } from '@aivastra/db';
import { and, count, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeEffectiveEnabled, inCollectionSetSql } from './activation.js';

export type BasketSource = 'manual' | 'rule';

/** The subset of a shopify_product_garments row that routing reads. */
export interface BasketMatchTarget {
  funnelTemplateId: string | null;
  productType: string | null;
  tags: string[] | null;
  vendor: string | null;
  collections: string[] | null;
  title: string | null;
}

export interface BasketRule {
  ruleId: string;
  basketId: string;
  priority: number;
  conditions: schema.FunnelRuleCondition[];
}

export interface BasketInfo {
  id: string;
  label: string;
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  isActive: boolean;
}

export interface BasketRuleSet {
  /** Store's own rules. Resolved entirely before globalRules. */
  storeRules: BasketRule[];
  /** Aivastra global rules, with this store's suppressions already removed. */
  globalRules: BasketRule[];
  baskets: Map<string, BasketInfo>;
}

export interface ResolvedBasket {
  basketId: string;
  label: string;
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  source: BasketSource;
}

const norm = (value: string): string => value.trim().toLowerCase();

function matchesText(
  value: string | null,
  operator: schema.FunnelRuleCondition['operator'],
  needle: string,
): boolean {
  if (!value) return false;
  const haystack = norm(value);
  return operator === 'equals' ? haystack === needle : haystack.includes(needle);
}

function matchesList(
  values: string[] | null,
  operator: schema.FunnelRuleCondition['operator'],
  needle: string,
): boolean {
  if (!values?.length) return false;
  return values.some((v) => matchesText(v, operator, needle));
}

/**
 * Case-insensitive throughout, deliberately: Shopify tags are free text typed
 * by merchants, so a rule written as `saree` failing to match a tag typed
 * `Saree` would be this feature's largest single source of support tickets.
 */
export function matchesCondition(
  condition: schema.FunnelRuleCondition,
  target: BasketMatchTarget,
): boolean {
  const needle = norm(condition.value);
  if (!needle) return false;
  switch (condition.field) {
    case 'product_type':
      return matchesText(target.productType, condition.operator, needle);
    case 'vendor':
      return matchesText(target.vendor, condition.operator, needle);
    case 'title':
      return matchesText(target.title, condition.operator, needle);
    case 'tags':
      return matchesList(target.tags, condition.operator, needle);
    case 'collections':
      return matchesList(target.collections, condition.operator, needle);
    default:
      return false;
  }
}

function byPriorityThenId(a: BasketRule, b: BasketRule): number {
  return a.priority - b.priority || a.ruleId.localeCompare(b.ruleId);
}

function resolved(basket: BasketInfo, source: BasketSource): ResolvedBasket {
  return {
    basketId: basket.id,
    label: basket.label,
    workflowTemplateId: basket.workflowTemplateId,
    workflowTemplateVersion: basket.workflowTemplateVersion,
    source,
  };
}

function activeBasket(ruleSet: BasketRuleSet, basketId: string | null): BasketInfo | null {
  if (!basketId) return null;
  const basket = ruleSet.baskets.get(basketId);
  return basket?.isActive ? basket : null;
}

/**
 * The ONE place basket precedence lives. Every caller — try-on creation, the
 * merchant product list, the Routing page counts — must go through this
 * function rather than re-deriving the rule, exactly as every activation
 * caller goes through computeEffectiveEnabled in activation.ts.
 *
 * Precedence: manual pin, then the store's own rules, then Aivastra global
 * rules. Null means nothing is configured at all — no pin, no matching rule
 * at either tier — which the try-on path treats as a refusal BEFORE
 * deducting credits. There is deliberately no further fallback: routing is
 * fully explicit, never a silent admin-wide catch-all.
 */
export function resolveBasketFrom(
  ruleSet: BasketRuleSet,
  target: BasketMatchTarget,
): ResolvedBasket | null {
  // A pin to a basket an admin has since deactivated falls through rather than
  // refusing: dead-ending every pinned product with no merchant-visible cause
  // is worse than a visible downgrade to the rule-derived basket.
  const pinned = activeBasket(ruleSet, target.funnelTemplateId);
  if (pinned) return resolved(pinned, 'manual');

  // Store tier resolves entirely before the global tier — a store rule at
  // priority 100 still beats a global rule at priority 1. Interleaving the two
  // by priority would let a merchant's own rule silently lose to a global rule
  // whose priority they cannot see.
  for (const tier of [ruleSet.storeRules, ruleSet.globalRules]) {
    for (const rule of [...tier].sort(byPriorityThenId)) {
      const basket = activeBasket(ruleSet, rule.basketId);
      if (!basket) continue;
      // An empty condition list matches NOTHING, never everything: read the
      // other way, a half-filled rule form becomes a catalog-wide hijack.
      if (rule.conditions.some((c) => matchesCondition(c, target))) {
        return resolved(basket, 'rule');
      }
    }
  }

  return null;
}

/**
 * Loads every basket plus both rule tiers for one store, with this store's
 * suppressions already removed from the global tier.
 *
 * Deliberately NOT cached. This is one small query per REQUEST (not per
 * product) on a path that then runs a GPU job; a Redis cache would need
 * invalidation fanned out to every store on each global-rule edit, for no
 * measured gain. Callers listing many products call this once and then run
 * resolveBasketFrom per row — that split is what keeps the list endpoints
 * free of an N+1.
 */
export async function loadRuleSet(app: FastifyInstance, storeId: string): Promise<BasketRuleSet> {
  const [basketRows, ruleRows] = await Promise.all([
    app.db
      .select({
        id: schema.shopifyFunnelTemplates.id,
        label: schema.shopifyFunnelTemplates.label,
        workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId,
        workflowTemplateVersion: schema.workflowTemplates.version,
        isActive: schema.shopifyFunnelTemplates.isActive,
      })
      .from(schema.shopifyFunnelTemplates)
      .leftJoin(
        schema.workflowTemplates,
        eq(schema.workflowTemplates.id, schema.shopifyFunnelTemplates.workflowTemplateId),
      ),
    app.db
      .select({
        ruleId: schema.shopifyFunnelRules.id,
        storeId: schema.shopifyFunnelRules.storeId,
        basketId: schema.shopifyFunnelRules.funnelTemplateId,
        priority: schema.shopifyFunnelRules.priority,
        conditions: schema.shopifyFunnelRules.conditions,
        suppressedAt: schema.shopifyStoreDisabledFunnelRules.createdAt,
      })
      .from(schema.shopifyFunnelRules)
      .leftJoin(
        schema.shopifyStoreDisabledFunnelRules,
        and(
          eq(schema.shopifyStoreDisabledFunnelRules.ruleId, schema.shopifyFunnelRules.id),
          eq(schema.shopifyStoreDisabledFunnelRules.storeId, storeId),
        ),
      )
      .where(
        or(
          eq(schema.shopifyFunnelRules.storeId, storeId),
          isNull(schema.shopifyFunnelRules.storeId),
        ),
      ),
  ]);

  const baskets = new Map<string, BasketInfo>();
  for (const row of basketRows) {
    baskets.set(row.id, {
      id: row.id,
      label: row.label,
      workflowTemplateId: row.workflowTemplateId,
      workflowTemplateVersion: row.workflowTemplateVersion ?? null,
      isActive: row.isActive,
    });
  }

  const storeRules: BasketRule[] = [];
  const globalRules: BasketRule[] = [];
  for (const row of ruleRows) {
    const rule: BasketRule = {
      ruleId: row.ruleId,
      basketId: row.basketId,
      priority: row.priority,
      conditions: row.conditions ?? [],
    };
    if (row.storeId) {
      storeRules.push(rule);
    } else if (!row.suppressedAt) {
      // A global rule this store has switched off. Suppression is per-store,
      // so it must be dropped here rather than anywhere shared.
      globalRules.push(rule);
    }
  }

  return { storeRules, globalRules, baskets };
}

/** Single-product convenience wrapper. Never use this inside a loop. */
export async function resolveBasket(
  app: FastifyInstance,
  storeId: string,
  target: BasketMatchTarget,
): Promise<ResolvedBasket | null> {
  return resolveBasketFrom(await loadRuleSet(app, storeId), target);
}

// Above this many synced products, a full per-row routing scan is too slow to
// run on every stat/read — the Routing tab, and every "Try-On Enabled" count
// that needs routing precision, fall back to the uncorrected count instead.
export const COUNTS_PRODUCT_CAP = 10_000;

export interface UnroutedCounts {
  countsOmitted: boolean;
  unrouted: number | null;
  unroutedEnabled: number | null;
  /** basketId -> count of products that resolve to it. Only meaningful when
   *  countsOmitted is false. */
  basketCounts: Record<string, number>;
}

/**
 * Per-product routing scan shared by the Routing tab's summary
 * (`funnel-rules.routes.ts`) and every "Try-On Enabled" stat that must
 * exclude effectively-enabled products with no resolvable basket
 * (`activation.routes.ts`, `me.routes.ts`). A synced, enabled product with no
 * pin and no matching rule can never actually complete a try-on —
 * `customer.routes.ts`'s creation path refuses it before enqueue — so none of
 * these surfaces may count it as enabled.
 */
export async function countUnroutedProducts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<UnroutedCounts> {
  const [{ total }] = await app.db
    .select({ total: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );

  if (total > COUNTS_PRODUCT_CAP) {
    return { countsOmitted: true, unrouted: null, unroutedEnabled: null, basketCounts: {} };
  }

  const mode = store.settings.activation?.mode ?? 'selective';
  const ruleSet = await loadRuleSet(app, store.id);
  const products = await app.db
    .select({
      funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
      productType: schema.shopifyProductGarments.productType,
      tags: schema.shopifyProductGarments.tags,
      vendor: schema.shopifyProductGarments.vendor,
      collections: schema.shopifyProductGarments.collections,
      title: schema.shopifyProductGarments.title,
      enabled: schema.shopifyProductGarments.enabled,
      excluded: schema.shopifyProductGarments.excluded,
      inEnabledCollection: sql<boolean>`${inCollectionSetSql(schema.shopifyEnabledCollections)}`,
      inExcludedCollection: sql<boolean>`${inCollectionSetSql(schema.shopifyExcludedCollections)}`,
    })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );

  const basketCounts: Record<string, number> = {};
  let unrouted = 0;
  let unroutedEnabled = 0;
  for (const p of products) {
    const resolved = resolveBasketFrom(ruleSet, p as BasketMatchTarget);
    if (resolved) {
      basketCounts[resolved.basketId] = (basketCounts[resolved.basketId] ?? 0) + 1;
    } else {
      unrouted++;
      const effectivelyEnabled = computeEffectiveEnabled({
        mode,
        individuallyEnabled: p.enabled,
        individuallyExcluded: p.excluded,
        inEnabledCollection: p.inEnabledCollection,
        inExcludedCollection: p.inExcludedCollection,
      });
      if (effectivelyEnabled) unroutedEnabled++;
    }
  }

  return { countsOmitted: false, unrouted, unroutedEnabled, basketCounts };
}

export interface UnroutedProductItem {
  shopifyProductId: number;
  title: string | null;
}

export interface UnroutedProductsList {
  items: UnroutedProductItem[];
  // More unrouted products exist than the cap below returns — the merchant
  // sees a "+N more" hint rather than a silently incomplete list.
  truncated: boolean;
  // Mirrors countUnroutedProducts' own cap: a store past COUNTS_PRODUCT_CAP
  // never gets a per-product scan here either.
  omitted: boolean;
}

const UNROUTED_LIST_CAP = 200;

/**
 * Titles behind the "Not routed" count in `countUnroutedProducts` — fetched
 * on demand (the popup, not the summary load) so a merchant can see exactly
 * which products need a rule or a pin, not just how many.
 */
export async function listUnroutedProducts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<UnroutedProductsList> {
  const [{ total }] = await app.db
    .select({ total: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );
  if (total > COUNTS_PRODUCT_CAP) {
    return { items: [], truncated: false, omitted: true };
  }

  const ruleSet = await loadRuleSet(app, store.id);
  const products = await app.db
    .select({
      shopifyProductId: schema.shopifyProductGarments.shopifyProductId,
      title: schema.shopifyProductGarments.title,
      funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
      productType: schema.shopifyProductGarments.productType,
      tags: schema.shopifyProductGarments.tags,
      vendor: schema.shopifyProductGarments.vendor,
      collections: schema.shopifyProductGarments.collections,
    })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );

  const items: UnroutedProductItem[] = [];
  for (const p of products) {
    if (!resolveBasketFrom(ruleSet, p as BasketMatchTarget)) {
      items.push({ shopifyProductId: p.shopifyProductId, title: p.title });
    }
  }

  return {
    items: items.slice(0, UNROUTED_LIST_CAP),
    truncated: items.length > UNROUTED_LIST_CAP,
    omitted: false,
  };
}

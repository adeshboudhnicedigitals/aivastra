import type { FunnelRuleCondition } from '@aivastra/db';

export type BasketSource = 'manual' | 'rule' | 'default';

/** The subset of a shopify_product_garments row that routing reads. */
export interface BasketMatchTarget {
  funnelTemplateId: string | null;
  productType: string | null;
  tags: string[] | null;
  vendor: string | null;
  collections: string[] | null;
}

export interface BasketRule {
  ruleId: string;
  basketId: string;
  priority: number;
  conditions: FunnelRuleCondition[];
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
  defaultBasketId: string | null;
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
  operator: FunnelRuleCondition['operator'],
  needle: string,
): boolean {
  if (!value) return false;
  const haystack = norm(value);
  return operator === 'equals' ? haystack === needle : haystack.includes(needle);
}

function matchesList(
  values: string[] | null,
  operator: FunnelRuleCondition['operator'],
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
  condition: FunnelRuleCondition,
  target: BasketMatchTarget,
): boolean {
  const needle = norm(condition.value);
  if (!needle) return false;
  switch (condition.field) {
    case 'product_type':
      return matchesText(target.productType, condition.operator, needle);
    case 'vendor':
      return matchesText(target.vendor, condition.operator, needle);
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
 * rules, then the default basket. Null means nothing is configured at all,
 * which the try-on path treats as a refusal BEFORE deducting credits.
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

  const fallback = activeBasket(ruleSet, ruleSet.defaultBasketId);
  return fallback ? resolved(fallback, 'default') : null;
}

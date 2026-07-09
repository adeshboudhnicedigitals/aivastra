export interface ShopifyPlan {
  id: string;
  name: string;
  priceCents: number;
  includedTryons: number;
  overageCents: number;
  trialDays: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface ShopifyStoreSettings {
  buttonText?: string;
  buttonColor?: string;
  position?: string;
  customCss?: string;
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
}

export interface ShopifyStats {
  totalTryOns: number;
  syncedProductCount: number;
  enabledProductCount: number;
  funnelConfigured: boolean;
}

export interface ShopifyMe {
  store: {
    shopDomain: string;
    settings: ShopifyStoreSettings;
  };
  plan: ShopifyPlan | null;
  stats: ShopifyStats;
}

export interface ShopifyOnboardingConfirmResponse {
  settings: ShopifyStoreSettings;
}

export interface ShopifyProductListItem {
  shopifyProductId: number;
  title: string | null;
  thumbnailUrl: string;
  status: string;
  enabled: boolean;
  funnelTemplateId: string | null;
  funnelAssignmentSource: 'manual' | 'automated' | null;
}

export interface ShopifyProductImage {
  id: number;
  src: string;
}

export interface FunnelRuleCondition {
  field: 'product_type' | 'tags' | 'vendor';
  operator: 'equals' | 'contains';
  value: string;
}

export interface FunnelRule {
  mode: 'manual' | 'automated';
  conditions: FunnelRuleCondition[];
  priority: number;
}

export interface FunnelTemplateItem {
  id: string;
  slug: string;
  label: string;
  rule: FunnelRule;
}

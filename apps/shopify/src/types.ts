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
  statusCounts: { active: number; processing: number; failed: number; disabled: number };
}

export interface ShopifyMe {
  store: {
    shopDomain: string;
    settings: ShopifyStoreSettings;
    ownerUserId: string | null;
    connectedSince: string;
  };
  creditBalance: number | null;
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
  field: 'product_type' | 'tags' | 'vendor' | 'collections';
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

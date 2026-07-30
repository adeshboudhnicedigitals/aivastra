export interface ShopifyStoreSettings {
  buttonText?: string;
  buttonColor?: string;
  position?: string;
  customCss?: string;
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
}

export interface ShopifyFunnelCounts {
  /** Products with a funnel template resolved — the only ones try-on can run for. */
  mapped: number;
  unmapped: number;
  byRule: number;
  byHand: number;
}

export interface ShopifyStats {
  totalTryOns: number;
  syncedProductCount: number;
  enabledProductCount: number;
  /** @deprecated true when `funnelCounts.mapped > 0` — says nothing about the rest. */
  funnelConfigured: boolean;
  funnelCounts: ShopifyFunnelCounts;
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

export interface CatalogOptionItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}

export interface CatalogPoseOption extends CatalogOptionItem {
  hasLower: boolean;
  hasShoes: boolean;
}

export interface CatalogOptions {
  garmentTypes: { id: string; label: string }[];
  faces: CatalogOptionItem[];
  backgrounds: CatalogOptionItem[];
  poses: CatalogPoseOption[];
  lowerItems: CatalogOptionItem[];
  shoeItems: CatalogOptionItem[];
}

export interface CatalogGenerateJob {
  jobId: string;
  catalogueId: string;
  status: string;
  errorCode: string | null;
  resultUrl: string | null;
  published: boolean;
  sourceImageUrl: string;
  createdAt: string;
}

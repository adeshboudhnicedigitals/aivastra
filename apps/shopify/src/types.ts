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
}

export interface ShopifyMe {
  store: {
    shopDomain: string;
    settings: ShopifyStoreSettings;
  };
  credits: number;
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
}

export interface ShopifyProductImage {
  id: number;
  src: string;
}

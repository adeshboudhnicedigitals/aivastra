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
}

export interface ShopifyProductImage {
  id: number;
  src: string;
}

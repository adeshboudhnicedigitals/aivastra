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
}

// Real response shape of GET /v1/shopify/me (apps/api/src/modules/shopify/me.routes.ts):
// { store: { shopDomain, settings }, credits, plan }
// Corrected from an earlier flat guess ({ shopDomain, planId, balance }) after reading the route handler.
export interface ShopifyMe {
  store: {
    shopDomain: string;
    settings: ShopifyStoreSettings;
  };
  credits: number;
  plan: ShopifyPlan | null;
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

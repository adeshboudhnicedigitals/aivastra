export interface ShopifyStoreLimits {
  /** null = off. Hard ceiling on generations per store-local day. */
  storeDailyCap?: number | null;
  /** null = off. Soft — defeatable by a fresh browser; see the design doc. */
  perShopperCap?: number | null;
  perShopperWindow?: 'day' | 'week' | 'month';
  /** null = never ask. 0 = ask before the first generation. */
  emailAfterNTryOns?: number | null;
}

export interface ShopifyStoreRetention {
  /** null = off, for all three. Days until deletion. */
  shopperPhotoDays?: number | null;
  resultDays?: number | null;
  shopperRecordDays?: number | null;
}

export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
}

export interface ShopifyWidgetTheme {
  accentColor?: string | null;
}

export interface ShopifyWidgetCopy {
  heading?: string | null;
  subheading?: string | null;
  uploadTitle?: string | null;
  uploadLead?: string | null;
  chooseLabel?: string | null;
  ctaLabel?: string | null;
  legalText?: string | null;
  generatingText?: string | null;
  errorText?: string | null;
}

export interface ShopifyWidgetBehavior {
  addToCart?: boolean;
  addToCartLabel?: string | null;
  share?: boolean;
  shareLabel?: string | null;
}

export interface ShopifyWidgetConfig {
  theme?: ShopifyWidgetTheme;
  copy?: ShopifyWidgetCopy;
  behavior?: ShopifyWidgetBehavior;
}

export interface ShopifyWidgetConfigResponse {
  widget: ShopifyWidgetConfig;
  synced: boolean;
}

export interface ShopifyStats {
  totalTryOns: number;
  syncedProductCount: number;
  enabledProductCount: number;
  statusCounts: { active: number; processing: number; failed: number; disabled: number };
  todayTryOns: number;
  storeDailyCap: number | null;
  capturedEmailCount: number;
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

export interface ShopifyShopperListItem {
  id: string;
  email: string;
  emailConsent: boolean;
  firstSeenAt: string;
  tryOnCount: number;
}

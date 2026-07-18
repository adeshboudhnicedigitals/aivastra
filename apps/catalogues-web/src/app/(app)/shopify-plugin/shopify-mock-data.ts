const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const MOCK_PRODUCT = {
  title: 'Banarasi Silk Saree - Royal Blue',
  seedMediaUrl: `${BASE}/assets/studio-right-div-placeholder.png`,
};

export const SHOPIFY_LEFT_NAV = [
  'Home',
  'Orders',
  'Products',
  'Customers',
  'Growth',
  'Discounts',
  'Content',
  'Markets',
  'Finance',
  'Analytics',
] as const;

export const SHOPIFY_SALES_CHANNELS = ['Online Store', 'Agentic'] as const;

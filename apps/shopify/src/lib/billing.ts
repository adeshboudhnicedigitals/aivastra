export function buildPlanSelectionUrl(shopDomain: string, appHandle: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

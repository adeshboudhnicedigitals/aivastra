export function buildPlanSelectionUrl(shopDomain: string, appHandle: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

export function resolvePlanSelectionUrl(
  shopDomain: string,
  appHandle: string,
): { url: string } | { error: string } {
  // Without the build arg the URL collapses to .../charges//pricing_plans,
  // which Shopify answers with a 404 — a dead-end the merchant cannot
  // diagnose. Fail loudly here instead of navigating them off the app.
  if (!appHandle) {
    return {
      error:
        'Plan selection is unavailable — this build is missing its Shopify app handle. Contact support@aivastra.com.',
    };
  }
  return { url: buildPlanSelectionUrl(shopDomain, appHandle) };
}

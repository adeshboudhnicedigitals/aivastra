declare global {
  interface Window {
    shopify?: {
      idToken(): Promise<string>;
    };
  }
}

export async function getIdToken(): Promise<string> {
  if (!window.shopify) {
    throw new Error('App Bridge not loaded — is this app running inside the Shopify admin iframe?');
  }
  return window.shopify.idToken();
}

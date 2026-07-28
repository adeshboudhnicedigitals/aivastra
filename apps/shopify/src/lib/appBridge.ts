declare global {
  interface Window {
    shopify?: {
      idToken(): Promise<string>;
    };
  }
}

// App Bridge's idToken() round-trips a postMessage to the parent Shopify admin
// frame. That channel can go stale (backgrounded tab, admin's own session
// refresh) and the promise then never settles — with no timeout here, the
// whole app hangs on its boot-time loading screen until the merchant reloads.
const ID_TOKEN_TIMEOUT_MS = 8000;

export async function getIdToken(): Promise<string> {
  if (!window.shopify) {
    throw new Error('App Bridge not loaded — is this app running inside the Shopify admin iframe?');
  }
  return Promise.race([
    window.shopify.idToken(),
    new Promise<string>((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out waiting for App Bridge session token')),
        ID_TOKEN_TIMEOUT_MS,
      );
    }),
  ]);
}

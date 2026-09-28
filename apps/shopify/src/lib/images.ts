/**
 * Rewrites a dev-only loopback image URL (product thumbnails presigned against
 * local MinIO, `http://127.0.0.1:9000/...`) to go through this app's own dev
 * proxy instead, when — and only when — the page itself isn't on a loopback
 * origin. Shopify's embedded admin loads over the public ngrok tunnel, and
 * Chrome's Private Network Access policy blocks that public-origin page from
 * fetching a loopback address directly (`net::ERR_FAILED`, "Permission was
 * denied ... `loopback` address space") — every thumbnail came back blank.
 *
 * This deliberately keys off the URL and the browser's own location rather
 * than an env flag: the API's shared storage config (R2_PUBLIC_PRESIGN_BASE)
 * is one process-wide setting used by every app that calls it, not just this
 * one, so baking the tunnel host in there would follow admin-web/catalogues-web
 * into their own local dev too, breaking their images whenever the Shopify
 * app's dev server + tunnel aren't running. Doing the rewrite here instead
 * means the ordinary case — this page loaded at plain http://localhost, no
 * tunnel in the picture, loopback fetching loopback — needs no rewrite at all,
 * and production URLs (never loopback) are untouched by construction.
 *
 * The target, `/minio/*` on this same origin, is proxied by vite.config.ts's
 * dev server to the API, which proxies it again to R2_ENDPOINT — see
 * apps/api/src/modules/dev/minio-proxy.routes.ts.
 */
export function resolveImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const pageIsLoopback =
    window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  if (!isLoopback || pageIsLoopback) return url;
  return `${window.location.origin}/minio${parsed.pathname}${parsed.search}`;
}

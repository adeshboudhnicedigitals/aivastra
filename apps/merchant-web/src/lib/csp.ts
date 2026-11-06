// Origins are derived from this build's own env vars rather than hardcoded, so
// the CSP always matches whatever this specific build actually talks to.
// Only NEXT_PUBLIC_API_URL: the browser calls the API at that URL (see
// lib/api.ts). The server-only API_URL is a container-internal address
// (e.g. http://api:4000) the browser cannot reach, so it must not appear here.
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');

/**
 * Nonce + 'strict-dynamic': Next.js auto-tags its own inline/streaming
 * scripts with the nonce it finds on the request, and 'strict-dynamic' lets
 * those trusted scripts load further scripts (Next's chunks) without every
 * origin being individually allow-listed. 'self' stays as a fallback for
 * browsers that don't support strict-dynamic.
 */
export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []), // Next dev/HMR needs eval; never shipped to prod
    ],
    // Inline `style="..."` attributes are pervasive — style-src unsafe-inline
    // can't execute JS, so the risk it accepts is far smaller than script-src would be.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'http://127.0.0.1:*', // local MinIO in dev — loopback-only, harmless outside a dev machine
      'https://*.r2.cloudflarestorage.com',
      ...(apiOrigin ? [apiOrigin] : []),
    ],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      'http://127.0.0.1:*',
      'https://*.r2.cloudflarestorage.com',
      ...(apiOrigin ? [apiOrigin] : []),
      ...(isDev ? ['ws://127.0.0.1:*', 'ws://localhost:*'] : []), // Next dev HMR websocket
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };

  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

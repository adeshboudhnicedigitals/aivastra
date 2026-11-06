// Server-side (BFF) API base. API_URL is read at runtime; NEXT_PUBLIC_API_URL is
// the build-time fallback (CLAUDE.md "Build-time vs runtime config").
export function serverApiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

// The API rate-limits on cf-connecting-ip (falling back to the socket IP). Without
// forwarding it every merchant shares the BFF's one bucket, so pass the visitor's through.
export function forwardedIpHeaders(req: Request): Record<string, string> {
  const ip = req.headers.get('cf-connecting-ip');
  return ip ? { 'cf-connecting-ip': ip } : {};
}

export function readSetCookie(res: Response): string | null {
  // getSetCookie() bypasses the forbidden-header restriction in Edge/undici.
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return h.getSetCookie ? h.getSetCookie().join(', ') || null : res.headers.get('set-cookie');
}

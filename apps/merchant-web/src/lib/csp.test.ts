import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The API origin is computed at module load, so each case sets env first and
// imports fresh.
async function cspWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { buildCsp } = await import('./csp');
  return buildCsp('n');
}

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
}

describe('buildCsp', () => {
  it('connect-src uses the browser-facing NEXT_PUBLIC_API_URL, not the server-only API_URL', async () => {
    const csp = await cspWith({
      API_URL: 'http://api:4000',
      NEXT_PUBLIC_API_URL: 'https://staging-app.aivastra.com',
    });
    const connect = directive(csp, 'connect-src');
    expect(connect).toContain('https://staging-app.aivastra.com');
    expect(connect).not.toContain('http://api:4000');
  });

  it('defaults to http://localhost:4000 when NEXT_PUBLIC_API_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    const csp = await cspWith({ API_URL: 'http://api:4000' });
    expect(directive(csp, 'connect-src')).toContain('http://localhost:4000');
  });

  it('img-src adds NEXT_PUBLIC_MEDIA_ORIGINS (images only), ignoring blanks and bad entries', async () => {
    const csp = await cspWith({
      NEXT_PUBLIC_MEDIA_ORIGINS:
        'https://media.example.com/bucket, not a url,,https://cdn.example.org',
    });
    const img = directive(csp, 'img-src');
    expect(img).toContain('https://media.example.com');
    expect(img).toContain('https://cdn.example.org');
    expect(img).not.toContain('not a url');
    expect(directive(csp, 'connect-src')).not.toContain('media.example.com');
  });

  it('adds nothing when NEXT_PUBLIC_MEDIA_ORIGINS is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_ORIGINS', '');
    const csp = await cspWith({});
    expect(directive(csp, 'img-src')).not.toContain('example');
  });
});

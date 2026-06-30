import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  transpilePackages: ['@aivastra/types'],
  async redirects() {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    return [
      { source: `${base}/dashboard`, destination: `${base}/catalogues`, permanent: true },
      { source: `${base}/jobs`, destination: `${base}/catalogues`, permanent: true },
      { source: `${base}/credits`, destination: `${base}/pricing`, permanent: true },
      { source: `${base}/account`, destination: `${base}/settings`, permanent: true },
    ];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
  images: {
    // Image optimizer fetches local images without basePath prefix → 404.
    // Disable optimization so Next.js renders plain <img> with the full
    // basePath-prefixed URL that NGINX can route correctly.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // MinIO via CloudPanel NGINX proxy
      { protocol: 'https', hostname: 'rankplex.cloud' },
      { protocol: 'https', hostname: 'app.aivastra.com' },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Upload source maps to Sentry only when SENTRY_AUTH_TOKEN is set (CI/prod build).
  // In local dev this is a no-op so the build stays fast.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Disable tunnel route — we're not worried about ad-blocker interference.
  tunnelRoute: undefined,
  webpack: {
    // Don't instrument server components with Sentry's auto-wrapping (avoids bundle bloat).
    autoInstrumentServerFunctions: false,
    treeshake: { removeDebugLogging: true },
  },
});

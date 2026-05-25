import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  transpilePackages: ['@aivastra/types'],
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
    ],
  },
};

export default nextConfig;

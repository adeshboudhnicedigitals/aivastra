import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // basePath for subpath hosting (e.g. /webtool). Empty string = root (dev default).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  transpilePackages: ['@aivastra/types'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // MinIO via CloudPanel NGINX proxy
      { protocol: 'https', hostname: 'rankplex.cloud' },
    ],
  },
};

export default nextConfig;

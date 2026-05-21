import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aivastra/types'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
};

export default nextConfig;

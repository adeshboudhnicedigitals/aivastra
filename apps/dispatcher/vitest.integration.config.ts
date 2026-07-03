import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      postgres: resolve(__dirname, '../../packages/db/node_modules/postgres/src/index.js'),
    },
  },
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['test/integration/**/*.test.ts'],
    // finalizeOutput() calls loadEnv() (full env.ts zod schema) on every
    // invocation to read ENABLE_WATERMARKING — in the real dispatcher process
    // these are always set via --env-file, but integration tests construct
    // db/s3/redis directly without going through index.ts's startup, so the
    // schema's required-but-unused-here fields need placeholder values.
    env: {
      DATABASE_URL: 'postgres://placeholder/placeholder',
      REDIS_URL: 'redis://127.0.0.1:6379',
      R2_ENDPOINT: 'http://127.0.0.1:9000',
      R2_ACCESS_KEY_ID: 'minioadmin',
      R2_SECRET_ACCESS_KEY: 'minioadmin_dev_pw',
      R2_BUCKET: 'placeholder',
      R2_PUBLIC_URL: 'http://127.0.0.1:9000/placeholder',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // Match vitest.config.ts — each file creates a fresh Postgres DB + runs migrations,
    // which routinely exceeds Vitest's 5s/10s defaults and was causing spurious timeouts.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Each file still gets its own Postgres DB + MinIO bucket; Redis DB index is now
    // assigned per Vitest worker (see containers.ts) so concurrent files no longer
    // race on jobs:*/config:system keys. Capped rather than left at Vitest's CPU-count
    // default so a small CI runner doesn't fire off dozens of concurrent
    // CREATE DATABASE + 150+-migration sequences against one Postgres instance at once.
    poolOptions: { threads: { maxThreads: 8, minThreads: 1 } },
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});

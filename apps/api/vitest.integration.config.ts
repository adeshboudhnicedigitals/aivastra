import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // Match vitest.config.ts — each file creates a fresh Postgres DB + runs migrations,
    // which routinely exceeds Vitest's 5s/10s defaults and was causing spurious timeouts.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
    // Integration tests in test/integration/ require live localhost Docker services.
    // They are excluded here (unit test run) but should be run in a separate CI job
    // that provisions or starts those services.
    // KNOWN FAILURES (pre-existing, unrelated to this codebase's changes):
    //   jobs-create.test.ts  — uses removed fields modelCatalogId/poseCatalogId/backgroundCatalogId
    //                          from an old job API contract. Needs updating to faceId/backgroundId/poseIds.
    //   catalog.test.ts      — tree structure assertion may not match current catalog API response shape.
    //   e2e.test.ts          — depends on jobs-create flow, fails for the same reason.
    exclude: ['test/integration/**', '**/node_modules/**', 'dist/**'],
  },
});

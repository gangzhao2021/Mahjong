import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts', 'apps/mobile/src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});

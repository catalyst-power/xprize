/**
 * Vitest configuration for the Phase A end-to-end integration harness.
 *
 * Kept entirely separate from the fast unit lane (vitest.config.ts) so
 * `npm test` never blocks on a live kernel. Run with:
 *
 *   npm run test:e2e   (KERNEL_URL must be set; tests self-skip when absent)
 *
 * pool: 'forks' — isolates each test file in its own process; avoids shared
 * module state between harness runs.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/__e2e__/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    clearMocks: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    exclude: [...defaultExclude, 'src/__e2e__/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

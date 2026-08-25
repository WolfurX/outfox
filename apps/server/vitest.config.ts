import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@outfox/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  ssr: { external: ['node:sqlite'] },
  test: {
    environment: 'node',
    server: { deps: { external: [/node:sqlite/] } },
  },

});

import { defineConfig } from 'tsup';

// @skillstack/shared ships TypeScript source, so it is bundled; everything else
// stays in node_modules and Render runs `node dist/server.js` after `pnpm install`.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@skillstack/shared'],
});

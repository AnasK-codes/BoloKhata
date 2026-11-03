import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // The shared package ships TypeScript source, so bundle it into the gateway.
  noExternal: ['@bolbill/shared'],
});

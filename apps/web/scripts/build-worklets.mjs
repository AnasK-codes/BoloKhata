// Compiles src/lib/audio/worklets/*.worklet.ts into public/worklets/*.js.
// Worklets run in their own global scope and load by URL, so each one is bundled into a single
// classic script. The DSP they use lives in plain modules under src/lib/audio/dsp, which Vitest
// tests import directly.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'src/lib/audio/worklets');

// "capture.worklet.ts" is published as "capture.js".
const entryPoints = Object.fromEntries(
  readdirSync(sourceDir)
    .filter((name) => name.endsWith('.worklet.ts'))
    .map((name) => [name.replace(/\.worklet\.ts$/, ''), join(sourceDir, name)]),
);

export const workletOptions = {
  entryPoints,
  outdir: join(root, 'public/worklets'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  logLevel: 'info',
};

/** Starts a watcher and resolves once the first build is done. Used by `pnpm dev`. */
export async function watchWorklets() {
  const ctx = await context(workletOptions);
  await ctx.watch();
  return ctx;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...workletOptions, minify: true });
}

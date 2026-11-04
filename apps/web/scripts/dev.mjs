// `pnpm dev`: rebuild the audio worklets on change next to the Next.js dev server.
import { spawn } from 'node:child_process';
import process from 'node:process';
import { watchWorklets } from './build-worklets.mjs';

const watcher = await watchWorklets();
const next = spawn('next', ['dev', ...process.argv.slice(2)], { stdio: 'inherit', shell: true });

const stop = (signal) => {
  next.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
next.on('exit', async (code) => {
  await watcher.dispose();
  process.exit(code ?? 0);
});

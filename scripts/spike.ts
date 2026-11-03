import { main } from './spike/main';

/**
 * `pnpm spike`: the ONLY script that intentionally spends Gnani credits.
 * Start with `pnpm spike --dry-run`. See scripts/spike/clips/README.md for the clips it needs.
 */
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('spike crashed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

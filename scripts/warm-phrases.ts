import { loadConfig } from '../apps/gateway/src/config';
import { PhraseCache } from '../apps/gateway/src/gnani/phraseCache';
import { fixedPhrases, findCached, planWarmup, runWarmup } from '../apps/gateway/src/gnani/warmPhrases';
import { silentLogger } from '../apps/gateway/src/util/logger';
import { loadSpikeEnv } from './spike/env';

/**
 * Pre-synthesises the fixed spoken phrases into the gateway's phrase cache, so common replies
 * ("Ho gaya, save kar diya.") start instantly. This SPENDS Gnani TTS credits unless the
 * endpoints point at the mock, so it has a character budget and a dry run that sends nothing.
 *
 *   pnpm warm-phrases --dry-run
 *   pnpm warm-phrases --budget 400
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const budgetIndex = args.indexOf('--budget');
const budget = budgetIndex >= 0 ? Number(args[budgetIndex + 1]) : 400;
if (!Number.isInteger(budget) || budget < 0) {
  console.error('--budget must be a whole number of characters');
  process.exit(1);
}

const spikeEnv = loadSpikeEnv(); // also loads .env into process.env
const config = loadConfig({
  ALLOWED_ORIGINS: 'http://localhost:3000',
  SESSION_TOKEN_SECRET: 'warm-phrases-not-a-secret',
  GNANI_API_KEY: spikeEnv.apiKey ?? 'dry-run-no-key',
  ...process.env,
});
const cache = new PhraseCache(config.gnani.tts.cacheDir, config.gnani.tts.cacheMemoryBytes);

const phrases = fixedPhrases();
const cached = await findCached(phrases, config.gnani.tts, cache);
const plan = planWarmup(phrases, budget, cached);

console.log(`Fixed phrases: ${phrases.length} (already cached: ${plan.alreadyCached.length})`);
console.log(`To synthesize: ${plan.toSynthesize.length} phrases, ${plan.chars} characters (budget ${budget})`);
if (plan.overBudget.length > 0) console.log(`Left out by the budget: ${plan.overBudget.length}`);
for (const phrase of plan.toSynthesize) console.log(`  + ${phrase}`);

if (dryRun) {
  console.log('Dry run: nothing was sent.');
  process.exit(0);
}
if (spikeEnv.apiKey === null) {
  console.error('GNANI_API_KEY is not set in .env, so a real run is not possible.');
  process.exit(1);
}
if (spikeEnv.mock) console.log('Note: the TTS endpoint is not Gnani, so no credits are spent.');
else console.log(`This will spend about ${plan.chars} TTS characters of Gnani credit.`);

const result = await runWarmup({ gnani: config.gnani, cache, plan, log: silentLogger });
console.log(`Done: ${result.synthesized} synthesized (${result.chars} characters), ${result.failed} failed.`);
process.exit(result.failed > 0 ? 1 : 0);

/**
 * ONE real LLM call, run by hand to find out whether the configured provider works:
 *   pnpm --filter @bolbill/gateway llm:check
 * It reads the same environment as the gateway (LLM_PROVIDER, BEDROCK_MODEL_ID, ...), sends a
 * fictional sentence, and prints the outcome and latency. It spends a few hundred tokens and never
 * runs in tests or on startup. The transcript is fictional, so printing it leaks nothing.
 */
import { parsedUtteranceSchema } from '@bolbill/shared';
import { loadConfig } from '../../config';
import { createLlmAdapter } from './index';
import { SYSTEM_PROMPT, buildUserBlock } from './prompt';

/** A CLI prints to stdout on purpose; the gateway logger is for the server. */
const say = (line: string): void => void process.stdout.write(`${line}\n`);

const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const adapter = createLlmAdapter(config.llm);

if (adapter.name === 'none') {
  say('LLM_PROVIDER is none: nothing to check. Set it to bedrock or openai-compatible first.');
  process.exit(0);
}

const transcript = 'Sharma ji ko teen kilo cheeni aur ek packet chai, do sau udhaar';
say(`Provider: ${adapter.name}  region: ${config.llm.awsRegion}  timeout: ${config.llm.timeoutMs} ms`);
const result = await adapter.generateStructured({
  system: SYSTEM_PROMPT,
  userBlock: buildUserBlock(transcript, {
    products: [{ name: 'Cheeni' }, { name: 'Chai' }],
    customers: [{ name: 'Sharma ji' }],
  }),
  schema: parsedUtteranceSchema,
  timeoutMs: config.llm.timeoutMs,
});

if (result.ok) {
  say(`OK in ${result.ms} ms (budget ${config.llm.timeoutMs} ms)`);
  say(JSON.stringify(result.value, null, 2));
} else {
  say(`FAILED: ${result.reason}${result.detail ? ` (${result.detail})` : ''} after ${result.ms} ms`);
  say('See docs/LLM.md for what each failure usually means.');
  process.exitCode = 1;
}

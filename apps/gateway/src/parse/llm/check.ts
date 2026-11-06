/**
 * ONE real LLM call, run by hand to find out whether the configured provider works:
 *   pnpm --filter @bolbill/gateway llm:check            # the JSON-mode call rules_ai uses
 *   pnpm --filter @bolbill/gateway llm:check -- --tools # the tool call PARSER_MODE=ai_only uses
 * It reads the same environment as the gateway (LLM_PROVIDER, BEDROCK_MODEL_ID, ...), sends a
 * fictional sentence, and prints the outcome and latency. It spends a few hundred tokens and never
 * runs in tests or on startup. The transcript is fictional, so printing it leaks nothing.
 */
import { parsedUtteranceSchema } from '@bolbill/shared';
import { loadConfig } from '../../config';
import { AGENT_SYSTEM_PROMPT } from '../agent/prompt';
import { AGENT_TOOLS, interpretToolCall } from '../agent/tools';
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
const names = { products: [{ name: 'Cheeni' }, { name: 'Chai' }], customers: [{ name: 'Sharma ji' }] };

if (process.argv.includes('--tools')) {
  if (!adapter.callTool) {
    say('This provider has no tool calling.');
    process.exit(1);
  }
  const called = await adapter.callTool({ system: AGENT_SYSTEM_PROMPT, userBlock: buildUserBlock(transcript, names), tools: AGENT_TOOLS, timeoutMs: config.llm.timeoutMs });
  if (!called.ok) {
    say(`FAILED: ${called.reason}${called.detail ? ` (${called.detail})` : ''} after ${called.ms} ms`);
    say('See docs/LLM.md for what each failure usually means.');
    process.exit(1);
  }
  const interpreted = interpretToolCall(called.value, transcript);
  say(`OK in ${called.ms} ms (budget ${config.llm.timeoutMs} ms)`);
  say(`tool: ${called.value.name}  accepted by the parser: ${interpreted ? 'yes' : 'NO (an amount nobody said, or bad arguments)'}`);
  say(JSON.stringify(called.value.args, null, 2));
  process.exit(interpreted ? 0 : 1);
}

const result = await adapter.generateStructured({
  system: SYSTEM_PROMPT,
  userBlock: buildUserBlock(transcript, names),
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

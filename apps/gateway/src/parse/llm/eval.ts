/**
 * Compares three ways of reading a sentence, on the SYNTHETIC set in evalSet.ts:
 *   rules     the rule parser alone (no network)
 *   fallback  rules first, the model only when the rules are unsure (how the gateway runs)
 *   always    the model reads every sentence (mode "always")
 *   pnpm --filter @bolbill/gateway llm:eval
 * It is a MANUAL script: it makes about one real call per sentence per model arm, one at a time, and
 * never runs in tests or on startup. Prices are computed by shared code from the catalog, never by
 * the model, so a wrong answer here is a wrong reading, not a wrong price.
 */
import { readFileSync } from 'node:fs';
import { CatalogIndex, type CatalogCustomer, type CatalogProduct } from '@bolbill/shared';
import { loadConfig } from '../../config';
import { Orchestrator, type ParseOutcome } from '../orchestrator';
import { createLlmAdapter } from './index';
import { EVAL_SET, type EvalCase } from './evalSet';
import { NoLlm } from './none';

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const adapter = createLlmAdapter(config.llm);
if (adapter.name === 'none') {
  say('LLM_PROVIDER is none: nothing to evaluate. Set it first.');
  process.exit(0);
}

const seed = JSON.parse(readFileSync(new URL('../../../../../data/seed-catalog.json', import.meta.url), 'utf8')) as {
  products: CatalogProduct[];
  customers: Pick<CatalogCustomer, 'id' | 'name' | 'aliases'>[];
};
const index = new CatalogIndex(seed.products, seed.customers.map((c) => ({ ...c, balance: 0 })));
const names = { products: seed.products, customers: seed.customers };

// A long timebox so quality is judged apart from speed; each call is also checked against the real one.
const GENEROUS_MS = 12_000;
const budget = config.llm.timeoutMs;
const rulesOnly = new Orchestrator({ llm: new NoLlm(), timeoutMs: budget, mode: 'fallback' });
const fallback = new Orchestrator({ llm: adapter, timeoutMs: GENEROUS_MS, mode: 'fallback' });
const always = new Orchestrator({ llm: adapter, timeoutMs: GENEROUS_MS, mode: 'always' });

function correct(c: EvalCase, o: ParseOutcome): boolean {
  if (o.parsed.intent !== c.intent) return false;
  const customer = o.resolution.customer;
  const got = customer === null ? null : customer.ambiguous ? 'ambiguous' : customer.id ?? null;
  if (c.customer !== got && !(c.customer === null && got === null)) return false;
  if (c.intent === 'record_payment') return o.parsed.amount_paid === c.paid;
  if (c.intent !== 'create_bill') return true;
  const bill = o.resolution.bill;
  if (!bill || bill.unresolvedItems.length > 0) return false;
  const have = bill.bill.items.map((i) => `${i.productId}:${i.quantity}`).sort();
  const want = (c.items ?? []).map((i) => `${i.id}:${i.quantity}`).sort();
  if (have.join() !== want.join()) return false;
  return c.udhaar === undefined || bill.bill.udhaar === c.udhaar;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const percentile = (xs: number[], p: number) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0);

say(`Provider: ${adapter.name}  budget in use by the gateway: ${budget} ms  sentences: ${EVAL_SET.length}`);
const tally = { rules: 0, fallback: 0, always: 0 };
const byTag = new Map<string, { n: number; rules: number; fallback: number; always: number }>();
const llmMs: number[] = [];
let llmCalls = 0;
let llmFailed = 0;
let fitsBudget = 0;
let totalMismatch = 0;
const misses: string[] = [];

for (const c of EVAL_SET) {
  const req = { transcript: c.text, index, names };
  const r = await rulesOnly.parse(req);
  const f = await fallback.parse(req);
  await pause(700);
  const a = await always.parse(req);
  await pause(700);
  for (const o of [f, a]) {
    if (o.llmMs !== undefined) { llmCalls++; llmMs.push(o.llmMs); if (o.llmMs <= budget) fitsBudget++; }
    if (o.llm !== 'ok' && o.llm !== 'skipped') llmFailed++;
  }
  const ok = { rules: correct(c, r), fallback: correct(c, f), always: correct(c, a) };
  const t = byTag.get(c.tag) ?? { n: 0, rules: 0, fallback: 0, always: 0 };
  t.n++;
  for (const k of ['rules', 'fallback', 'always'] as const) { if (ok[k]) { tally[k]++; t[k]++; } }
  byTag.set(c.tag, t);
  // A model must never change a price: when both readings agree on the items, the totals must too.
  if (r.resolution.bill && a.resolution.bill && r.resolution.bill.bill.items.map((i) => i.productId + i.quantity).join() === a.resolution.bill.bill.items.map((i) => i.productId + i.quantity).join() && r.resolution.bill.bill.total !== a.resolution.bill.bill.total) totalMismatch++;
  if (!ok.rules || !ok.fallback || !ok.always) misses.push(`  [${c.tag}] rules ${ok.rules ? 'ok ' : 'MISS'} fallback ${ok.fallback ? 'ok ' : 'MISS'} always ${ok.always ? 'ok ' : 'MISS'}  (${f.llm}/${a.llm})  ${c.text}`);
}

const pct = (n: number, d: number) => `${n}/${d} (${Math.round((100 * n) / d)}%)`;
say('\nCorrect (intent, customer, items, amounts):');
say(`  rules only          ${pct(tally.rules, EVAL_SET.length)}`);
say(`  rules + model       ${pct(tally.fallback, EVAL_SET.length)}   (the gateway's fallback mode)`);
say(`  model on everything ${pct(tally.always, EVAL_SET.length)}`);
say('\nBy kind:');
for (const [tag, t] of byTag) say(`  ${tag.padEnd(11)} n=${String(t.n).padEnd(2)} rules ${t.rules}  fallback ${t.fallback}  always ${t.always}`);
say(`\nModel calls: ${llmCalls}, failed: ${llmFailed}, finished within the gateway budget (${budget} ms): ${fitsBudget}`);
say(`Model latency ms: p50 ${percentile(llmMs, 0.5)}  p95 ${percentile(llmMs, 0.95)}  max ${Math.max(0, ...llmMs)}`);
say(`Same items but a different total between rules and model: ${totalMismatch} (must be 0)`);
if (misses.length > 0) { say('\nDisagreements:'); misses.forEach(say); }

/**
 * Multi-turn bill dialogue: what to ask when a bill is only partly understood, and how to read the
 * next utterance as the answer to that question.
 *
 * The open question lives in the draft (`clarification`), and the browser sends the draft back with
 * every press, so the gateway keeps no hidden state and a reconnect loses nothing. Pure: no I/O.
 *
 * The rules, in order:
 *   1. "cancel" cancels the draft. Anything that is clearly another command (a balance question, a
 *      payment, "naya bill ...", a premature "haan") is handled as that command.
 *   2. Otherwise the utterance is read as the answer to the open slot and merged into the draft.
 *   3. If it does not answer the slot, the original words and the new ones are parsed together once.
 *   4. Still nothing: a miss. The caller asks again, at most twice in all, then shows taps instead.
 *
 * Prices are never decided here: the merged items go back through the shared pricing code.
 */
import { LIMITS } from '../protocol/constants';
import type { Unit } from '../protocol/common';
import { MAX_CLARIFY_ATTEMPTS, type Clarification, type DraftMessage } from '../protocol/server';
import type { CatalogMatcher } from '../domain/matching';
import type { UnresolvedItem } from '../domain/pricing';
import { extractQuantityAndUnit, parseNumber, tokenizeSpeech } from '../domain/numberWords';
import { fold, foldSet } from './extras';
import { CONFIDENCE_THRESHOLD, parseUtterance, shortAnswer } from './ruleBased';
import type { MissingItem, ParsedItemOutput, ParsedUtterance } from './schema';

export type FollowUp =
  /** Cancel the whole draft. */
  | { kind: 'cancel' }
  /** Not an answer: handle the utterance as a fresh command. */
  | { kind: 'command' }
  /** The draft with the answer merged in, to be priced and checked again like any bill. */
  | { kind: 'answer'; parsed: ParsedUtterance; transcript: string }
  /** Something was said, but it did not answer the question. */
  | { kind: 'missed'; transcript: string };

/** Joins what was said across turns, for display and for the combined parse. */
const JOIN = ' · ';

const CANCEL_WORDS = foldSet(['cancel', 'radd', 'कैंसल', 'रद्द']);
const NEW_BILL = foldSet(['naya', 'nayi', 'new', 'नया']);
const REMOVE_WORDS = foldSet(['hatao', 'hata', 'hatado', 'nikalo', 'nikaal', 'nikal', 'remove', 'chhodo', 'chodo', 'rehne', 'rahne', 'हटाओ', 'हटा', 'रहने']);
const NEGATION = foldSet(['nahi', 'nahin', 'nai', 'na', 'no', 'नहीं', 'नही']);
/** Filler that may surround a bare negation ("nahi ji", "nahi chahiye"). */
const NEGATION_FILLER = foldSet(['ji', 'chahiye', 'chaiye', 'do', 'bas', 'bhai', 'yaar', 'चाहिए', 'दो']);
/** Intents that are clearly a different request, not an answer about this bill. */
const OTHER_COMMANDS: ReadonlySet<ParsedUtterance['intent']> = new Set([
  'record_payment', 'query_balance', 'query_summary', 'add_customer', 'add_product', 'add_products', 'update_price', 'out_of_stock',
]);

export function answerFollowUp(context: DraftMessage, text: string, matcher: CatalogMatcher): FollowUp {
  const ask = context.clarification;
  if (context.intent !== 'create_bill' || !context.bill || !ask) return { kind: 'command' };
  const said = typeof text === 'string' ? text.slice(0, LIMITS.maxTranscriptLength) : '';
  const transcript = joinTranscript(ask.transcript, said);
  const tokens = tokenizeSpeech(said);
  const f = tokens.map(fold);
  if (f.length === 0) return { kind: 'missed', transcript };

  if (f.some((t) => CANCEL_WORDS.has(t))) return { kind: 'cancel' };
  if (f.some((t) => NEW_BILL.has(t)) && f.some((t) => t === fold('bill'))) return { kind: 'command' };

  const base = draftAsParsed(context);
  // "kesar hatao", "rehne do", a bare "nahi": drop the item being asked about, keep the bill.
  if (ask.slot !== 'customer' && (f.some((t) => REMOVE_WORDS.has(t)) || isBareNegation(f))) {
    return { kind: 'answer', parsed: withoutTarget(base, context, ask), transcript };
  }
  // A premature "haan" while a question is open: ask the question again rather than refuse.
  if (shortAnswer(said) === 'confirm') return { kind: 'missed', transcript: ask.transcript };
  if (shortAnswer(said) !== null) return { kind: 'command' };

  // "nahi, do kilo": the correction is what follows the negation.
  const answerText = stripLeadingNegation(tokens, f);
  const parsed = parseUtterance(answerText, matcher);
  if (OTHER_COMMANDS.has(parsed.intent) && parsed.confidence >= CONFIDENCE_THRESHOLD) return { kind: 'command' };

  // A sentence that names a different customer is a new bill, not an answer about this one.
  if (ask.slot !== 'customer' && parsed.customer !== null && parsed.items.length > 0 && !sameCustomer(parsed.customer, base.customer, matcher)) {
    return { kind: 'command' };
  }

  const filled = fillSlot(base, context, ask, answerText, parsed, matcher);
  if (filled === 'command') return { kind: 'command' };
  if (filled) return { kind: 'answer', parsed: filled, transcript };

  // Second attempt: everything said for this bill, parsed as one sentence.
  const combined = parseUtterance(transcript.split(JOIN).join(' '), matcher);
  if (combined.intent === 'create_bill' && !combined.missingItems && allResolved(combined.items, matcher) && combined.items.length > base.items.length - pendingCount(context)) {
    const adjust = base.adjust ?? combined.adjust;
    return { kind: 'answer', parsed: { ...combined, customer: combined.customer ?? base.customer, ...(adjust ? { adjust } : {}) }, transcript };
  }
  return { kind: 'missed', transcript };
}

/** The draft's bill as parsed items: catalog lines by name, then the items still unresolved. */
export function draftAsParsed(context: DraftMessage): ParsedUtterance {
  const bill = context.bill;
  const items: ParsedItemOutput[] = (bill?.items ?? []).map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    ...(i.spokenPrice ? { spokenPrice: { amount: i.spokenPrice.amount, basis: i.spokenPrice.basis, unit: i.spokenPrice.unit, quantity: i.spokenPrice.quantity } } : {}),
  }));
  for (const u of context.unresolved) {
    if (u.kind === 'item') items.push({ name: u.spoken, quantity: u.quantity ?? 1, unit: u.unit ?? null });
  }
  const ambiguous = context.unresolved.find((u) => u.kind === 'customer');
  return {
    intent: 'create_bill',
    customer: context.customer?.name ?? ambiguous?.spoken ?? null,
    items: items.slice(0, LIMITS.maxBillItems),
    // A fully paid draft stays fully paid; a credit draft keeps what was paid.
    amount_paid: bill && bill.udhaar > 0 ? bill.paid : null,
    udhaar_amount: null,
    confidence: 1,
    ...(bill?.adjust ? { adjust: bill.adjust } : {}),
  };
}

export interface ClarifyInput {
  /** Everything said for this bill so far. */
  transcript: string;
  /** Quantities heard with no item name. */
  missing: readonly MissingItem[];
  unresolved: readonly UnresolvedItem[];
  /** Bill lines whose amount was vague ("thoda aata"). */
  unclearQuantity: readonly number[];
  /** A credit bill with no customer: "udhaar kiska likhun?" */
  needsCustomer?: boolean;
  previous?: Clarification;
}

/**
 * The one question to ask next, or undefined when the bill is complete. A missing item comes
 * first, then an unknown item, then a vague amount, then an ambiguous customer. Asking about the
 * same thing again counts an attempt; after MAX_CLARIFY_ATTEMPTS the screen offers taps instead.
 */
export function nextClarification(input: ClarifyInput): Clarification | undefined {
  const transcript = input.transcript.slice(0, LIMITS.maxTranscriptLength);
  const missing = input.missing[0];
  const item = input.unresolved.find((u) => u.kind === 'item');
  const unclear = input.unclearQuantity[0];
  const customer = input.unresolved.find((u) => u.kind === 'customer');
  let ask: Omit<Clarification, 'attempts' | 'fallback'> | undefined;
  if (missing) ask = { slot: 'item', quantity: missing.quantity, ...(missing.unit ? { unit: missing.unit } : {}), transcript };
  else if (item) ask = { slot: 'item', spoken: item.spoken, ...(item.quantity !== undefined ? { quantity: item.quantity } : {}), ...(item.unit ? { unit: item.unit } : {}), transcript };
  else if (unclear !== undefined && unclear < LIMITS.maxBillItems) ask = { slot: 'quantity', itemIndex: unclear, transcript };
  else if (customer) ask = { slot: 'customer', spoken: customer.spoken, transcript };
  else if (input.needsCustomer) ask = { slot: 'customer', transcript };
  if (!ask) return undefined;

  const prev = input.previous;
  if (!prev || !sameQuestion(prev, ask)) return { ...ask, attempts: 1, fallback: false };
  const asked = prev.attempts + 1;
  return prev.fallback || asked > MAX_CLARIFY_ATTEMPTS ? { ...ask, attempts: MAX_CLARIFY_ATTEMPTS, fallback: true } : { ...ask, attempts: asked, fallback: false };
}

/** The same question asked again after a miss: one more attempt, or the tap fallback. */
export function repeatClarification(prev: Clarification, transcript: string): Clarification {
  const asked = prev.attempts + 1;
  const next = { ...prev, transcript: transcript.slice(0, LIMITS.maxTranscriptLength) };
  return prev.fallback || asked > MAX_CLARIFY_ATTEMPTS ? { ...next, attempts: MAX_CLARIFY_ATTEMPTS, fallback: true } : { ...next, attempts: asked };
}

// ---- helpers ------------------------------------------------------------------------------

/**
 * Whether two questions are "the same slot" for the attempt cap. An unknown item answered with
 * another unknown name is the same question (otherwise the loop could go on forever); a vague
 * amount is the same question only for the same bill line.
 */
function sameQuestion(prev: Clarification, next: Omit<Clarification, 'attempts' | 'fallback'>): boolean {
  if (prev.slot !== next.slot) return false;
  if (next.slot === 'quantity') return prev.itemIndex === next.itemIndex;
  if (next.slot === 'item') return (prev.spoken === undefined) === (next.spoken === undefined);
  return true;
}

function joinTranscript(before: string, now: string): string {
  const said = now.trim();
  const joined = before && said ? `${before}${JOIN}${said}` : before || said;
  return joined.slice(0, LIMITS.maxTranscriptLength);
}

function sameCustomer(spoken: string, current: string | null, matcher: CatalogMatcher): boolean {
  if (current === null) return false;
  const a = matcher.matchCustomer(spoken).best?.id;
  return a !== undefined ? a === matcher.matchCustomer(current).best?.id : fold(spoken) === fold(current);
}

function isBareNegation(f: readonly string[]): boolean {
  return f.some((t) => NEGATION.has(t)) && f.every((t) => NEGATION.has(t) || NEGATION_FILLER.has(t));
}

function stripLeadingNegation(tokens: readonly string[], f: readonly string[]): string {
  let start = 0;
  while (start < f.length && (NEGATION.has(f[start] ?? '') || f[start] === fold('ji'))) start++;
  return tokens.slice(start).join(' ');
}

/** How many of the draft's parsed items are still waiting on an answer (unresolved ones). */
function pendingCount(context: DraftMessage): number {
  return context.unresolved.filter((u) => u.kind === 'item').length;
}

function allResolved(items: readonly ParsedItemOutput[], matcher: CatalogMatcher): boolean {
  return items.length > 0 && items.every((i) => i.spokenPrice !== undefined || (matcher.matchProduct(i.name).best !== null && !matcher.matchProduct(i.name).ambiguous));
}

/** Index (in `draftAsParsed` order) of the unresolved item the question is about. */
function unresolvedTarget(context: DraftMessage, ask: Clarification): number {
  if (ask.slot !== 'item' || ask.spoken === undefined) return -1;
  const lines = context.bill?.items.length ?? 0;
  let k = 0;
  for (const u of context.unresolved) {
    if (u.kind !== 'item') continue;
    if (u.spoken === ask.spoken) return lines + k;
    k++;
  }
  return -1;
}

function withoutTarget(base: ParsedUtterance, context: DraftMessage, ask: Clarification): ParsedUtterance {
  // A missing item (no name) was never on the bill: answering "nahi" simply closes the question.
  if (ask.slot === 'item' && ask.spoken === undefined) return base;
  const target = ask.slot === 'quantity' ? ask.itemIndex ?? -1 : unresolvedTarget(context, ask);
  return target < 0 ? base : { ...base, items: base.items.filter((_, i) => i !== target) };
}

/** A quantity anywhere in the answer ("ek kilo", "aata do kilo", "250 gram"). */
function findQuantity(text: string): { quantity: number; unit: Unit | null } | null {
  const tokens = tokenizeSpeech(text);
  for (let i = 0; i < tokens.length; i++) {
    const q = extractQuantityAndUnit(tokens.slice(i));
    if (q && q.quantity > 0) return { quantity: q.quantity, unit: q.unit };
  }
  return null;
}

const hasNumber = (text: string): boolean => tokenizeSpeech(text).some((t) => parseNumber(t) !== null) || findQuantity(text) !== null;

/** The merged draft, 'command' when the answer is clearly about something else, or null for a miss. */
function fillSlot(
  base: ParsedUtterance,
  context: DraftMessage,
  ask: Clarification,
  answer: string,
  parsed: ParsedUtterance,
  matcher: CatalogMatcher,
): ParsedUtterance | 'command' | null {
  switch (ask.slot) {
    case 'quantity': {
      const index = ask.itemIndex ?? -1;
      const target = base.items[index];
      if (!target) return null;
      const targetId = matcher.matchProduct(target.name).best?.id;
      // "do kilo chawal" while asked about aata: a different item with its own amount is a new command.
      const other = parsed.items.find((i) => matcher.matchProduct(i.name).best?.id !== targetId);
      if (other && parsed.items.length > 0 && parsed.intent === 'create_bill' && hasNumber(answer)) return 'command';
      const q = findQuantity(answer);
      if (!q) return null;
      const items = base.items.map((item, i) => (i === index ? { name: item.name, quantity: q.quantity, unit: q.unit ?? item.unit } : item));
      return { ...base, items };
    }
    case 'item': {
      if (parsed.items.length === 0) return null;
      const [first, ...rest] = parsed.items;
      if (!first) return null;
      // "aata" after "do kilo kya?": the amount already heard is kept unless a new one was said.
      const keepAmount = !hasNumber(answer) && ask.quantity !== undefined;
      const answerItem: ParsedItemOutput = keepAmount
        ? { name: first.name, quantity: ask.quantity ?? 1, unit: ask.unit ?? null }
        : stripFlag(first);
      const target = unresolvedTarget(context, ask);
      const items = target >= 0 ? base.items.map((item, i) => (i === target ? answerItem : item)) : [...base.items, answerItem];
      return { ...base, items: [...items, ...rest.map(stripFlag)].slice(0, LIMITS.maxBillItems) };
    }
    case 'customer': {
      if (parsed.intent === 'create_bill' && parsed.items.length > 0) return 'command';
      const match = matcher.matchCustomer(parsed.customer ?? answer);
      if (match.best && !match.ambiguous) return { ...base, customer: match.best.name };
      // "Udhaar kiska likhun?" can be answered with a new name; a choice between two cannot.
      const name = ask.spoken === undefined ? newCustomerName(answer) : null;
      return name ? { ...base, customer: name } : null;
    }
  }
}

const NAME_FILLER = foldSet(['ji', 'ka', 'ke', 'ki', 'ko', 'naam', 'nam', 'pe', 'par', 'likho', 'likh', 'do', 'hai', 'udhaar', 'udhar']);
const MAX_NAME_WORDS = 4;

/** A short spoken name ("Mohan Lal ji"), title-cased, or null when it does not look like one. */
function newCustomerName(answer: string): string | null {
  const tokens = tokenizeSpeech(answer);
  if (tokens.some((t) => parseNumber(t) !== null)) return null;
  const words = tokens.filter((t) => !NAME_FILLER.has(fold(t)));
  if (words.length < 1 || words.length > MAX_NAME_WORDS) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, LIMITS.maxNameLength);
}

function stripFlag(item: ParsedItemOutput): ParsedItemOutput {
  if (!item.quantityUnclear) return item;
  const { quantityUnclear: _drop, ...rest } = item;
  return rest;
}

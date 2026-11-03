import {
  billReadback,
  cancelled,
  customerNotFound,
  itemNotFound,
  nothingPending,
  notUnderstood,
  paymentRecorded,
  saved,
} from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import { DailyCreditGuard } from '../guard/creditGuard';
import type { Logger } from '../util/logger';
import { phraseCacheKey, type PhraseCache } from './phraseCache';
import { sanitizeSpeechText, TtsLink } from './ttsLink';

/**
 * The fixed spoken phrases: replies that contain no customer name and no amount, so the same
 * audio is correct every time. Everything else (bill readbacks with totals, balances) is
 * synthesised live. Taken from the shared templates so the two cannot drift apart.
 */
export function fixedPhrases(): string[] {
  const phrases = new Set<string>();
  const add = (sentences: readonly string[]) => {
    for (const sentence of sentences) {
      const text = sanitizeSpeechText(sentence);
      if (text !== null) phrases.add(text);
    }
  };
  for (let variant = 0; variant < 3; variant++) {
    add(saved(variant));
    add(cancelled(variant));
    add(notUnderstood(variant));
    add(nothingPending(variant));
    add(customerNotFound(null, variant));
    add(itemNotFound(null, variant));
    // Only the closing question of these is free of names and amounts.
    add(billReadback({ total: 0, udhaar: 0 }, variant).slice(1));
    add(paymentRecorded(null, 1, variant).slice(1));
  }
  return [...phrases];
}

export interface WarmupPlan {
  /** In order, within the budget. */
  toSynthesize: string[];
  alreadyCached: string[];
  /** Left out because the character budget ran out. */
  overBudget: string[];
  chars: number;
}

export function planWarmup(
  phrases: readonly string[],
  budgetChars: number,
  cached: ReadonlySet<string>,
): WarmupPlan {
  const plan: WarmupPlan = { toSynthesize: [], alreadyCached: [], overBudget: [], chars: 0 };
  for (const phrase of phrases) {
    if (cached.has(phrase)) plan.alreadyCached.push(phrase);
    else if (plan.chars + phrase.length <= budgetChars) {
      plan.toSynthesize.push(phrase);
      plan.chars += phrase.length;
    } else plan.overBudget.push(phrase);
  }
  return plan;
}

export async function findCached(
  phrases: readonly string[],
  tts: GatewayConfig['gnani']['tts'],
  cache: PhraseCache,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const text of phrases) {
    const key = phraseCacheKey({
      text,
      voice: tts.voice,
      model: tts.model,
      language: tts.language,
      sampleRate: tts.sampleRate,
    });
    if (await cache.has(key)) found.add(text);
  }
  return found;
}

export interface WarmupResult {
  synthesized: number;
  failed: number;
  chars: number;
}

/** Synthesises the planned phrases one at a time through a normal TtsLink, filling the cache. */
export async function runWarmup(options: {
  gnani: GatewayConfig['gnani'];
  cache: PhraseCache;
  plan: WarmupPlan;
  log: Logger;
}): Promise<WarmupResult> {
  // The guard enforces the budget even if the plan is wrong.
  const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: options.plan.chars });
  const link = new TtsLink({ gnani: options.gnani, guard, log: options.log, cache: options.cache });
  const result: WarmupResult = { synthesized: 0, failed: 0, chars: 0 };
  try {
    for (const [index, text] of options.plan.toSynthesize.entries()) {
      const turnId = index + 1;
      const outcome = await new Promise<'ok' | 'failed'>((resolve) => {
        link.on('end', (id) => id === turnId && resolve('ok'));
        link.on('failure', (f) => f.turnId === turnId && resolve('failed'));
        link.on('budget', (id) => id === turnId && resolve('failed'));
        if (!link.speak(turnId, [text], { cache: true })) resolve('failed');
      });
      if (outcome === 'ok') {
        result.synthesized++;
        result.chars += text.length;
      } else result.failed++;
    }
    await link.flush(); // the last phrase must reach the disk before the caller exits
  } finally {
    link.close();
  }
  return result;
}

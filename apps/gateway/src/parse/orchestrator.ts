import {
  CONFIDENCE_THRESHOLD,
  isInstructionLike,
  parseUtterance,
  parsedUtteranceSchema,
  type CatalogIndex,
  type ParsedUtterance,
} from '@bolbill/shared';
import { SYSTEM_PROMPT, buildUserBlock, type LlmAdapter, type LlmFailureReason } from './llm';
import type { PromptCatalog } from './llm/prompt';
import { itemsResolved, resolveUtterance, type Resolution } from './resolve';

/** What happened with the model on this turn, for logs, metrics and the HUD. */
export type LlmStatus = 'skipped' | 'ok' | LlmFailureReason;

export interface ParseOutcome {
  parsed: ParsedUtterance;
  resolution: Resolution;
  source: 'rules' | 'llm';
  /** The user should look at this draft before confirming. */
  needsReview: boolean;
  llm: LlmStatus;
  /** Wall time of the model call, when one was made. */
  llmMs?: number;
}

export interface ParseRequest {
  transcript: string;
  index: CatalogIndex;
  /** Names for the model prompt. */
  names: PromptCatalog;
  /** Fires when the turn is interrupted or superseded; cancels a model call in flight. */
  signal?: AbortSignal;
  /** Called right after each stage, so the caller can record `rules_done` and `llm_done`. */
  mark?: (span: 'rules_done' | 'llm_done') => void;
}

export interface OrchestratorOptions {
  llm: LlmAdapter;
  timeoutMs: number;
  /** 'always': the model sees every utterance first. 'fallback': only when the rules are unsure. */
  mode?: 'fallback' | 'always';
  /** Test hook for the circuit breaker's clock. */
  now?: () => number;
  /** False only for the manual eval, which must ask the model about every sentence. */
  breaker?: boolean;
}

/** Consecutive timeouts or errors that open the breaker, and how long it then skips the model. */
const BREAKER_FAILURES = 3;
const BREAKER_COOLDOWN_MS = 30_000;
const isRateLimited = (detail: string | undefined): boolean => detail === 'HttpError429' || detail === 'ThrottlingException';

const isShortAnswer = (p: ParsedUtterance): boolean => p.intent === 'confirm' || p.intent === 'cancel';
/** Intents that change stock or read shop-wide numbers: rules only, never from a model. */
const isRulesOnly = (p: ParsedUtterance): boolean => p.intent === 'out_of_stock' || p.intent === 'query_summary';

/**
 * Rules first, model second (default). With `mode: 'always'` the model is asked on every turn
 * (except confirm/cancel) and its answer is used; the rules result is the fallback.
 *
 * 1. The shared rule parser runs synchronously (this function reaches its first `await` only
 *    after the rules have finished). A confident result with every item resolved is returned
 *    without touching the model.
 * 2. Otherwise the model gets one timeboxed attempt. Its answer is validated, then matched against
 *    the catalog and priced in code (`resolveUtterance`): the model never supplies a price.
 * 3. Timeout, error, bad output or "no model configured": the rules result is returned, flagged
 *    for review. The turn never waits longer than the timeout.
 *
 * confirm and cancel are rules-only, both ways: a one-word answer must be fast, and a model must
 * never be able to confirm or cancel a bill.
 */
export class Orchestrator {
  private failures = 0;
  private openUntil = 0;
  private readonly now: () => number;

  constructor(private readonly options: OrchestratorOptions) {
    this.now = options.now ?? Date.now;
  }

  async parse(request: ParseRequest): Promise<ParseOutcome> {
    const rules = parseUtterance(request.transcript, request.index);
    const rulesResolution = resolveUtterance(rules, request.index);
    request.mark?.('rules_done');

    if (isShortAnswer(rules) || (isRulesOnly(rules) && rules.confidence >= CONFIDENCE_THRESHOLD)) return outcome(rules, rulesResolution, 'rules', false, 'skipped');
    const rulesAreSure = rules.confidence >= CONFIDENCE_THRESHOLD && itemsResolved(rules, rulesResolution);
    // Explicit shopkeeper prices are rules-only, including invalid quotes needing review.
    // A model may help with unpriced catalog orders, but may never rewrite a spoken amount.
    if (rules.items.some((item) => item.spokenPrice !== undefined)) return outcome(rules, rulesResolution, 'rules', !rulesAreSure, 'skipped');
    if (rulesAreSure && this.options.mode !== 'always') {
      return outcome(rules, rulesResolution, 'rules', false, 'skipped');
    }
    // Nothing for a model to work on, or text that is trying to instruct it.
    if (request.transcript.trim() === '' || isInstructionLike(request.transcript)) {
      return outcome(rules, rulesResolution, 'rules', true, 'skipped');
    }

    // A sick or rate-limited provider would add its whole timebox to every unsure sentence: skip it
    // for a while (one Orchestrator serves every session, so this is process-wide).
    if (this.options.breaker !== false && this.now() < this.openUntil) return outcome(rules, rulesResolution, 'rules', !rulesAreSure, 'skipped');

    const result = await this.options.llm.generateStructured({
      system: SYSTEM_PROMPT,
      userBlock: buildUserBlock(request.transcript, request.names),
      schema: parsedUtteranceSchema,
      timeoutMs: this.options.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    request.mark?.('llm_done');
    this.track(result);

    if (!result.ok) {
      return { ...outcome(rules, rulesResolution, 'rules', !rulesAreSure, result.reason), llmMs: result.ms };
    }
    // Revalidate here too: adapters/test hooks cannot smuggle rules-only price metadata.
    const validated = parsedUtteranceSchema.safeParse(result.value);
    if (!validated.success || isShortAnswer(validated.data) || isRulesOnly(validated.data)) {
      return { ...outcome(rules, rulesResolution, 'rules', !rulesAreSure, 'invalid_output'), llmMs: result.ms };
    }
    const resolution = resolveUtterance(validated.data, request.index);
    const review = validated.data.confidence < CONFIDENCE_THRESHOLD || (resolution.bill?.needsReview ?? false);
    return { ...outcome(validated.data, resolution, 'llm', review, 'ok'), llmMs: result.ms };
  }

  /** Timeouts and provider errors count; an interrupted turn or a bad answer says nothing about health. */
  private track(result: Awaited<ReturnType<LlmAdapter['generateStructured']>>): void {
    if (result.ok) {
      this.failures = 0;
      return;
    }
    if (result.reason !== 'timeout' && result.reason !== 'unavailable') return;
    this.failures = isRateLimited(result.detail) ? BREAKER_FAILURES : this.failures + 1;
    if (this.failures >= BREAKER_FAILURES) this.openUntil = this.now() + BREAKER_COOLDOWN_MS;
  }
}

function outcome(
  parsed: ParsedUtterance,
  resolution: Resolution,
  source: 'rules' | 'llm',
  review: boolean,
  llm: LlmStatus,
): ParseOutcome {
  return {
    parsed,
    resolution,
    source,
    needsReview: review || (resolution.bill?.needsReview ?? false),
    llm,
  };
}

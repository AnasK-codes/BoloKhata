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
}

const isShortAnswer = (p: ParsedUtterance): boolean => p.intent === 'confirm' || p.intent === 'cancel';

/**
 * Rules first, model second.
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
  constructor(private readonly options: OrchestratorOptions) {}

  async parse(request: ParseRequest): Promise<ParseOutcome> {
    const rules = parseUtterance(request.transcript, request.index);
    const rulesResolution = resolveUtterance(rules, request.index);
    request.mark?.('rules_done');

    if (isShortAnswer(rules)) return outcome(rules, rulesResolution, 'rules', false, 'skipped');
    if (rules.confidence >= CONFIDENCE_THRESHOLD && itemsResolved(rules, rulesResolution)) {
      return outcome(rules, rulesResolution, 'rules', false, 'skipped');
    }
    // Nothing for a model to work on, or text that is trying to instruct it.
    if (request.transcript.trim() === '' || isInstructionLike(request.transcript)) {
      return outcome(rules, rulesResolution, 'rules', true, 'skipped');
    }

    const result = await this.options.llm.generateStructured({
      system: SYSTEM_PROMPT,
      userBlock: buildUserBlock(request.transcript, request.names),
      schema: parsedUtteranceSchema,
      timeoutMs: this.options.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    request.mark?.('llm_done');

    if (!result.ok) {
      return { ...outcome(rules, rulesResolution, 'rules', true, result.reason), llmMs: result.ms };
    }
    // A model may not confirm or cancel anything. Treat that answer as unusable.
    if (isShortAnswer(result.value)) {
      return { ...outcome(rules, rulesResolution, 'rules', true, 'invalid_output'), llmMs: result.ms };
    }
    const resolution = resolveUtterance(result.value, request.index);
    const review = result.value.confidence < CONFIDENCE_THRESHOLD || (resolution.bill?.needsReview ?? false);
    return { ...outcome(result.value, resolution, 'llm', review, 'ok'), llmMs: result.ms };
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

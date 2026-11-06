import type { z } from 'zod';

/**
 * The LLM is an optional helper that turns a messy transcript into the same structured shape the
 * rule parser produces. It never prices anything: prices come from the catalog in code.
 */
export type LlmFailureReason =
  /** LLM_PROVIDER=none: callers fall back to the rules result. */
  | 'not_configured'
  | 'timeout'
  /** The caller's signal fired (the turn was interrupted or superseded). */
  | 'aborted'
  /** The model answered, but not with something that passes the schema. */
  | 'invalid_output'
  /** Network, credentials, quota, model access: anything else. `detail` is an error name only. */
  | 'unavailable';

export type LlmResult<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; reason: LlmFailureReason; ms: number; detail?: string };

export interface StructuredRequest<T> {
  /** Static instructions; identical for every turn so providers can cache it. */
  system: string;
  /** Per-turn data: the delimited transcript plus catalog names. */
  userBlock: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** One tool the model may call. `parameters` is plain JSON Schema (type, properties, required, enum, items,
 * description only: the subset every provider accepts); `schema` validates the arguments that come back. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType<unknown>;
}

export interface ToolRequest {
  system: string;
  userBlock: string;
  tools: readonly ToolSpec[];
  timeoutMs: number;
  signal?: AbortSignal;
}

/** The tool the model chose, with arguments already validated by that tool's schema. */
export interface ToolCall {
  name: string;
  args: unknown;
}

export interface LlmAdapter {
  readonly name: 'bedrock' | 'openai-compatible' | 'none';
  generateStructured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>>;
  /** Tool calling, for PARSER_MODE=ai_only. The model must call exactly one tool. */
  callTool?(request: ToolRequest): Promise<LlmResult<ToolCall>>;
}

import type { LlmAdapter, LlmResult, ToolCall } from './types';

/** LLM_PROVIDER=none: the orchestrator keeps the rules result. Never touches the network. */
export class NoLlm implements LlmAdapter {
  readonly name = 'none' as const;

  generateStructured<T>(): Promise<LlmResult<T>> {
    return Promise.resolve({ ok: false, reason: 'not_configured', ms: 0 });
  }

  callTool(): Promise<LlmResult<ToolCall>> {
    return Promise.resolve({ ok: false, reason: 'not_configured', ms: 0 });
  }
}

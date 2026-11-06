import { z } from 'zod';
import { runTimeboxed } from './request';
import type { LlmAdapter, LlmResult, StructuredRequest, ToolCall, ToolRequest } from './types';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Sent as `reasoning_effort` (Gemini's compatibility API). Lower means a faster answer. */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  /** Injected in tests; defaults to the platform fetch. */
  fetch?: typeof fetch;
}

const responseSchema = z.looseObject({
  choices: z
    .array(z.looseObject({ message: z.looseObject({ content: z.string().nullable() }) }))
    .min(1),
});

/**
 * Any server that speaks POST {baseUrl}/chat/completions with JSON mode. The structure is
 * requested as a JSON object and validated here; the model is never trusted to be well-formed.
 */
export class OpenAiCompatibleLlm implements LlmAdapter {
  readonly name = 'openai-compatible' as const;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  generateStructured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>> {
    return runTimeboxed(
      request,
      async (signal) => {
        const response = await this.fetchImpl(this.url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0,
            max_tokens: 300,
            response_format: { type: 'json_object' },
            ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
            messages: [
              { role: 'system', content: `${request.system}\n\nReply with one JSON object only.` },
              { role: 'user', content: request.userBlock },
            ],
          }),
        });
        if (!response.ok) throw new HttpError(response.status);
        return response.json();
      },
      (raw) => {
        const envelope = responseSchema.safeParse(raw);
        const content = envelope.success ? envelope.data.choices[0]?.message.content : null;
        if (!content) return null;
        let json: unknown;
        try {
          json = JSON.parse(content);
        } catch {
          return null;
        }
        const checked = request.schema.safeParse(json);
        return checked.success ? checked.data : null;
      },
    );
  }

  /** Function calling (`tools` + `tool_choice: required`): the model must call one of the given tools. */
  callTool(request: ToolRequest): Promise<LlmResult<ToolCall>> {
    return runTimeboxed(
      request,
      async (signal) => {
        const response = await this.fetchImpl(this.url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0,
            max_tokens: 400,
            tool_choice: 'required',
            ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
            tools: request.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.userBlock },
            ],
          }),
        });
        if (!response.ok) throw new HttpError(response.status);
        return response.json();
      },
      (raw) => {
        const envelope = toolResponseSchema.safeParse(raw);
        const call = envelope.success ? envelope.data.choices[0]?.message.tool_calls?.[0]?.function : undefined;
        const tool = call ? request.tools.find((t) => t.name === call.name) : undefined;
        if (!call || !tool) return null;
        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          return null;
        }
        const checked = tool.schema.safeParse(args);
        return checked.success ? { name: tool.name, args: checked.data } : null;
      },
    );
  }
}

const toolResponseSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        message: z.looseObject({
          tool_calls: z
            .array(z.looseObject({ function: z.looseObject({ name: z.string(), arguments: z.string() }) }))
            .optional(),
        }),
      }),
    )
    .min(1),
});

class HttpError extends Error {
  constructor(status: number) {
    super(`http ${status}`);
    this.name = `HttpError${status}`;
  }
}

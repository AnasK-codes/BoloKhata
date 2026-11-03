import { z } from 'zod';
import { runTimeboxed } from './request';
import type { LlmAdapter, LlmResult, StructuredRequest } from './types';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
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
}

class HttpError extends Error {
  constructor(status: number) {
    super(`http ${status}`);
    this.name = `HttpError${status}`;
  }
}

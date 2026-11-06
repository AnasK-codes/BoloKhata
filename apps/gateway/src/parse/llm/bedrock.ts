import { Agent } from 'node:https';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { runTimeboxed } from './request';
import type { LlmAdapter, LlmResult, StructuredRequest, ToolCall, ToolRequest } from './types';

const TOOL_NAME = 'record_parse';
const MAX_OUTPUT_TOKENS = 300;

/** The one method of the AWS client that this adapter uses, so tests can pass a fake. */
export interface ConverseClient {
  send(
    command: ConverseCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<ConverseCommandOutput>;
}

export interface BedrockOptions {
  region: string;
  /** A model ID or an inference profile ID/ARN. Never guessed: it comes from BEDROCK_MODEL_ID. */
  modelId: string;
  client?: ConverseClient;
}

/**
 * Amazon Bedrock Converse API with forced tool use: the model must answer by calling a single tool
 * whose input schema is our parser schema, so the reply is structured JSON, not prose.
 *
 * Credentials come from the default AWS provider chain (instance role on EC2, or local profile or
 * environment variables in dev). Nothing here reads a key from config or the client.
 * UNVERIFIED on this project's AWS Free Plan account: model access, quota and region. See docs/LLM.md.
 */
export class BedrockLlm implements LlmAdapter {
  readonly name = 'bedrock' as const;
  private readonly client: ConverseClient;
  private readonly modelId: string;

  constructor(options: BedrockOptions) {
    this.modelId = options.modelId;
    this.client =
      options.client ??
      new BedrockRuntimeClient({
        region: options.region,
        // One socket kept warm, so a fallback call does not pay a TLS handshake.
        requestHandler: { httpsAgent: new Agent({ keepAlive: true, maxSockets: 8 }) },
        maxAttempts: 1, // a retry would blow the timebox; the orchestrator already falls back
      });
  }

  generateStructured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>> {
    const input: ConverseCommandInput = {
      modelId: this.modelId,
      system: [{ text: request.system }],
      messages: [{ role: 'user', content: [{ text: request.userBlock }] }],
      inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: 0 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: TOOL_NAME,
              description: 'Record the structured meaning of the shopkeeper sentence.',
              inputSchema: { json: toToolSchema(request.schema) },
            },
          },
        ],
        toolChoice: { tool: { name: TOOL_NAME } },
      },
    };
    return runTimeboxed(
      request,
      (signal) => this.client.send(new ConverseCommand(input), { abortSignal: signal }),
      (raw) => {
        const toolInput = pickToolInput(raw);
        if (toolInput === undefined) return null;
        const checked = request.schema.safeParse(toolInput);
        return checked.success ? checked.data : null;
      },
    );
  }

  /** Several tools with `toolChoice: any`: the model must call one of them. */
  callTool(request: ToolRequest): Promise<LlmResult<ToolCall>> {
    const input: ConverseCommandInput = {
      modelId: this.modelId,
      system: [{ text: request.system }],
      messages: [{ role: 'user', content: [{ text: request.userBlock }] }],
      inferenceConfig: { maxTokens: 400, temperature: 0 },
      toolConfig: {
        tools: request.tools.map((t) => ({
          toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters as Record<string, never> } },
        })),
        toolChoice: { any: {} },
      },
    };
    return runTimeboxed(
      request,
      (signal) => this.client.send(new ConverseCommand(input), { abortSignal: signal }),
      (raw) => {
        const content = (raw as ConverseCommandOutput | null)?.output?.message?.content;
        if (!Array.isArray(content)) return null;
        for (const block of content) {
          const tool = block.toolUse ? request.tools.find((t) => t.name === block.toolUse?.name) : undefined;
          if (!tool) continue;
          const checked = tool.schema.safeParse(block.toolUse?.input);
          return checked.success ? { name: tool.name, args: checked.data } : null;
        }
        return null;
      },
    );
  }
}

/** Bedrock wants a plain JSON Schema object; drop zod's `$schema` marker. */
function toToolSchema(schema: z.ZodType): Record<string, never> {
  const { $schema: _marker, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest as Record<string, never>;
}

function pickToolInput(raw: unknown): unknown {
  const content = (raw as ConverseCommandOutput | null)?.output?.message?.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (block.toolUse?.name === TOOL_NAME) return block.toolUse.input;
  }
  return undefined;
}

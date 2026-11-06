import type { GatewayConfig } from '../../config';
import { BedrockLlm } from './bedrock';
import { NoLlm } from './none';
import { OpenAiCompatibleLlm } from './openaiCompatible';
import type { LlmAdapter } from './types';

export * from './types';
export { SYSTEM_PROMPT, buildUserBlock } from './prompt';

/**
 * Picks the adapter from config. Config validation already guarantees the fields each provider
 * needs, so a missing value here is a programming error and fails loudly.
 */
export function createLlmAdapter(llm: GatewayConfig['llm']): LlmAdapter {
  switch (llm.provider) {
    case 'none':
      return new NoLlm();
    case 'bedrock':
      if (!llm.bedrockModelId) throw new Error('BEDROCK_MODEL_ID is required for bedrock');
      return new BedrockLlm({ region: llm.awsRegion, modelId: llm.bedrockModelId });
    case 'openai-compatible':
      if (!llm.openai.baseUrl || !llm.openai.model) throw new Error('OPENAI_BASE_URL and OPENAI_MODEL are required');
      return new OpenAiCompatibleLlm({
        baseUrl: llm.openai.baseUrl,
        model: llm.openai.model,
        ...(llm.openai.apiKey ? { apiKey: llm.openai.apiKey } : {}),
        ...(llm.openai.reasoningEffort ? { reasoningEffort: llm.openai.reasoningEffort } : {}),
      });
  }
}

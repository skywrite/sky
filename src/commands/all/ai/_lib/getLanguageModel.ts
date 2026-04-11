import type { LanguageModel } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAI, openai } from '@ai-sdk/openai'
import { ollama } from 'ollama-ai-provider-v2'

export type Provider = 'claude' | 'openai' | 'ollama' | 'lm-studio'

export const PROVIDER_DEFAULTS: Record<Provider, string> = {
  claude: 'claude-opus-4-6',
  openai: 'gpt-5.2',
  ollama: 'glm-4.7-flash:latest',
  'lm-studio': 'zai-org/glm-4.7-flash',
}

export function resolveProvider(provider?: string): Provider {
  return (provider || 'claude').toLowerCase() as Provider
}

export function resolveModel(provider: Provider, model?: string): string {
  return model || PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.claude
}

export function getLanguageModel(provider: string, model?: string): LanguageModel {
  const p = resolveProvider(provider)
  const modelName = resolveModel(p, model)

  switch (p) {
    case 'openai':
      return openai(modelName)
    case 'ollama':
      return ollama(modelName)
    case 'lm-studio': {
      const lmStudio = createOpenAI({
        baseURL: 'http://localhost:1234/v1',
        apiKey: 'lm-studio',
      })
      return lmStudio(modelName)
    }
    case 'claude':
    default:
      return anthropic(modelName)
  }
}

import OpenAI from 'openai'
import { env } from '#shared/sys/mod.ts'

export interface OpenAIPromptOptions {
  prompt: string
  model?: string
  maxTokens?: number
  apiKey?: string
  jsonMode?: boolean
}

export async function prompt(options: OpenAIPromptOptions): Promise<string> {
  const apiKey = options.apiKey || env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set')
  }

  const client = new OpenAI({ apiKey })

  // If JSON mode is enabled, add instruction to the prompt
  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only.'
  }

  const response = await client.chat.completions.create({
    model: options.model || 'gpt-5.2',
    max_completion_tokens: options.maxTokens || 120000,
    messages: [
      {
        role: 'user',
        content: finalPrompt,
      },
    ],
    ...(options.jsonMode && { response_format: { type: 'json_object' } }),
  })

  const content = response.choices[0]?.message?.content
  if (content) {
    return content
  }

  throw new Error('Unexpected response from OpenAI')
}

export async function* promptStream(options: OpenAIPromptOptions): AsyncIterator<string> {
  const apiKey = options.apiKey || env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set')
  }

  const client = new OpenAI({ apiKey })

  // If JSON mode is enabled, add instruction to the prompt
  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only.'
  }

  const stream = await client.chat.completions.create({
    model: options.model || 'gpt-5',
    max_completion_tokens: options.maxTokens || 120000,
    messages: [
      {
        role: 'user',
        content: finalPrompt,
      },
    ],
    stream: true,
    ...(options.jsonMode && { response_format: { type: 'json_object' } }),
  })

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      yield content
    }
  }
}

export async function listModels(apiKey?: string): Promise<string[]> {
  const key = apiKey || env.get('OPENAI_API_KEY')
  if (!key) {
    throw new Error('OPENAI_API_KEY environment variable not set')
  }

  const client = new OpenAI({ apiKey: key })
  const models = await client.models.list()

  return models.data.map((model) => model.id)
}

// Re-export vision functions
export { visionFromBytes, visionFromFile } from './vision.ts'
export type { OpenAIVisionOptions } from './vision.ts'

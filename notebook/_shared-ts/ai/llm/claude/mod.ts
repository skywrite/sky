import Anthropic from '@anthropic-ai/sdk'
import { env } from '#shared/sys/mod.ts'
import { extractJSON } from './_extractJSON.ts'

export interface ClaudePromptOptions {
  prompt: string
  model?: string
  maxTokens?: number
  apiKey?: string
  jsonMode?: boolean
  system?: string
  enableCache?: boolean
}

export async function prompt(options: ClaudePromptOptions): Promise<string> {
  const apiKey = options.apiKey || env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set')
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: 10 * 60 * 1000, // 10 minutes
  })

  // If JSON mode is enabled, add instruction to the prompt
  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only, without markdown code fences or any other formatting.'
  }

  // Build system message with optional caching
  const system = options.system
    ? options.enableCache
      ? [{ type: 'text' as const, text: options.system, cache_control: { type: 'ephemeral' as const } }]
      : [{ type: 'text' as const, text: options.system }]
    : undefined

  const response = await client.messages.create({
    model: options.model || 'claude-sonnet-4-5-20250929',
    max_tokens: options.maxTokens || 64000,
    temperature: 0,
    ...(system && { system }),
    messages: [
      {
        role: 'user',
        content: finalPrompt,
      },
    ],
  })

  // Log cache statistics if available (to stderr so it's visible)
  if (response.usage) {
    const usage = response.usage as any
    console.error(
      '[Claude Usage]',
      JSON.stringify(
        {
          input_tokens: usage.input_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
        },
        null,
        2,
      ),
    )
  }

  const content = response.content[0]
  if (content.type === 'text') {
    let text = content.text

    // If JSON mode is enabled, extract clean JSON
    if (options.jsonMode) {
      text = extractJSON(text)
    }

    return text
  }

  throw new Error('Unexpected response type from Claude')
}

export async function* promptStream(options: ClaudePromptOptions): AsyncIterator<string> {
  const apiKey = options.apiKey || env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set')
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: 10 * 60 * 1000, // 10 minutes
  })

  // If JSON mode is enabled, add instruction to the prompt
  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only, without markdown code fences or any other formatting.'
  }

  // Build system message with optional caching
  const system = options.system
    ? options.enableCache
      ? [{ type: 'text' as const, text: options.system, cache_control: { type: 'ephemeral' as const } }]
      : [{ type: 'text' as const, text: options.system }]
    : undefined

  const stream = await client.messages.create({
    model: options.model || 'claude-sonnet-4-5-20250929',
    max_tokens: options.maxTokens || 64000,
    temperature: 0,
    ...(system && { system }),
    messages: [
      {
        role: 'user',
        content: finalPrompt,
      },
    ],
    stream: true,
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text
    }
  }
}

export async function listModels(apiKey?: string): Promise<string[]> {
  const key = apiKey || env.get('ANTHROPIC_API_KEY')
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set')
  }

  const client = new Anthropic({ apiKey: key })
  const models = await client.models.list()

  return models.data.map((model) => model.id)
}

import { Ollama } from 'ollama'

export interface OllamaPromptOptions {
  prompt: string
  model?: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  system?: string
  jsonMode?: boolean
}

export async function prompt(options: OllamaPromptOptions): Promise<string> {
  const ollama = new Ollama()

  const messages: Array<{ role: string; content: string }> = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only.'
  }

  messages.push({ role: 'user', content: finalPrompt })

  const response = await ollama.chat({
    model: options.model || 'deepseek-r1:1.5b',
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0,
      ...(options.maxTokens && { num_predict: options.maxTokens }),
      ...(options.contextWindow && { num_ctx: options.contextWindow }),
    },
    ...(options.jsonMode && { format: 'json' }),
  })

  const content = response.message?.content
  if (content) {
    return content
  }

  throw new Error('Unexpected response from Ollama')
}

export async function* promptStream(options: OllamaPromptOptions): AsyncIterator<string> {
  const ollama = new Ollama()

  const messages: Array<{ role: string; content: string }> = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  let finalPrompt = options.prompt
  if (options.jsonMode) {
    finalPrompt += '\n\nOutput your response as valid JSON only.'
  }

  messages.push({ role: 'user', content: finalPrompt })

  const stream = await ollama.chat({
    model: options.model || 'deepseek-r1:1.5b',
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0,
      ...(options.maxTokens && { num_predict: options.maxTokens }),
      ...(options.contextWindow && { num_ctx: options.contextWindow }),
    },
    ...(options.jsonMode && { format: 'json' }),
  })

  for await (const chunk of stream) {
    const content = chunk.message?.content
    if (content) {
      yield content
    }
  }
}

export async function listModels(): Promise<string[]> {
  const ollama = new Ollama()
  const response = await ollama.list()

  if (!response.models || response.models.length === 0) {
    return []
  }

  return response.models.map((model) => model.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

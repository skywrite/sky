import OpenAI from 'openai'

export const DEFAULT_MODEL = 'qwen/qwen3.6-35b-a3b'

export interface LMStudioPromptOptions {
  prompt: string
  model?: string
  temperature?: number
  maxTokens?: number
  system?: string
  baseURL?: string
  // Note: LM Studio uses OpenAI-compatible API which doesn't support context window parameters.
  // The context window is determined by the model loaded in LM Studio's GUI.
}

export async function prompt(options: LMStudioPromptOptions): Promise<string> {
  const baseURL = options.baseURL || 'http://localhost:1234/v1'

  const client = new OpenAI({
    baseURL,
    apiKey: 'lm-studio', // Dummy key, LM Studio doesn't require auth
  })

  const messages: Array<{ role: string; content: string }> = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  messages.push({ role: 'user', content: options.prompt })

  const completion = await client.chat.completions.create({
    model: options.model || DEFAULT_MODEL,
    messages: messages as any,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 2000,
  })

  const content = completion.choices[0]?.message?.content
  if (content) {
    return content
  }

  throw new Error('Unexpected response from LM Studio')
}

export async function* promptStream(options: LMStudioPromptOptions): AsyncIterator<string> {
  const baseURL = options.baseURL || 'http://localhost:1234/v1'

  const client = new OpenAI({
    baseURL,
    apiKey: 'lm-studio', // Dummy key, LM Studio doesn't require auth
  })

  const messages: Array<{ role: string; content: string }> = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  messages.push({ role: 'user', content: options.prompt })

  const stream = await client.chat.completions.create({
    model: options.model || DEFAULT_MODEL,
    messages: messages as any,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 2000,
    stream: true,
  })

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      yield content
    }
  }
}

export async function listModels(baseURL?: string): Promise<string[]> {
  const url = baseURL || 'http://localhost:1234/v1'

  const client = new OpenAI({
    baseURL: url,
    apiKey: 'lm-studio', // Dummy key, LM Studio doesn't require auth
  })

  const models = await client.models.list()
  const modelList: string[] = []

  for await (const model of models) {
    modelList.push(model.id)
  }

  return modelList.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

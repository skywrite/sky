import OpenAI from 'openai'
import type { ChatCompletionCreateParams, ChatCompletionMessageParam } from 'openai/resources/chat'

export interface LMStudioConfig {
  baseURL?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export class LMStudioClient {
  private client: OpenAI
  private defaultModel: string

  constructor(config: LMStudioConfig = {}) {
    // LM Studio runs locally on port 1234 by default
    const baseURL = config.baseURL || 'http://localhost:1234/v1'

    // No API key needed for local LM Studio
    this.client = new OpenAI({
      baseURL,
      apiKey: 'lm-studio', // Dummy key, LM Studio doesn't require auth
    })

    // Default model - you can change this to whatever model you have loaded
    this.defaultModel = config.model || 'local-model'
  }

  async chat(messages: ChatCompletionMessageParam[], options: Partial<ChatCompletionCreateParams> = {}) {
    try {
      const completion = await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2000,
        ...options,
        stream: false,
      })

      return completion.choices[0]?.message?.content || ''
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Cannot connect to LM Studio. Make sure it is running on localhost:1234')
      }
      throw error
    }
  }

  async *chatStream(messages: ChatCompletionMessageParam[], options: Partial<ChatCompletionCreateParams> = {}) {
    try {
      const stream = (await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2000,
        stream: true,
        ...options,
      })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          yield content
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Cannot connect to LM Studio. Make sure it is running on localhost:1234')
      }
      throw error
    }
  }

  async listModels() {
    try {
      const models = await this.client.models.list()
      const modelList: string[] = []

      for await (const model of models) {
        modelList.push(model.id)
      }

      return modelList
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Cannot connect to LM Studio. Make sure it is running on localhost:1234')
      }
      throw error
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.listModels()
      return true
    } catch {
      return false
    }
  }
}

// Export a default instance for convenience
export const lmStudio = new LMStudioClient()

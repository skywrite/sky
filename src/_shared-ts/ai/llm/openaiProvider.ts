import { createOpenAI } from '@ai-sdk/openai'
import { withOpenAITokenCount } from '#shared/ai/inputTokenLimit.ts'

export const openai = createOpenAI({
  fetch: withOpenAITokenCount(((input, init) => fetch(input, init)) as typeof fetch),
})

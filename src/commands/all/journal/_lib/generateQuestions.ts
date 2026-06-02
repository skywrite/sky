import { generateObject } from 'ai'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { JournalContext } from './gatherContext.ts'
import type { JournalType } from '#shared/models/Journal/type.d.ts'

const PROFILE = 'default-opus-4.8'
const PROMPT_FILE = new URL('../prompts/generate-questions.prompt.md', import.meta.url).pathname

export interface GeneratedQuestion {
  type: JournalType
  question: string
}

const QuestionSchema = z.object({
  questions: z.array(
    z.object({
      type: z.string().describe('A journal category — use an existing type or invent a new one if warranted'),
      question: z.string().describe('A specific, actionable question based on the context'),
    }),
  ),
})

/**
 * Generate 10 contextual journal questions using AI.
 * Each question is assigned to a journal type.
 */
export async function generateQuestions(context: JournalContext): Promise<GeneratedQuestion[]> {
  const promptContent = await readTextFile(PROMPT_FILE)
  const { output: prompt } = renderPromptFile(promptContent, 'generate-questions.prompt.md', {
    journal: {
      date: context.today.date,
      dayOfWeek: context.today.dayOfWeek,
      time: context.today.time,
      timeOfDay: context.today.timeOfDay,
      contextMarkdown: context.contextMarkdown,
    },
  })

  const result = await generateObject({
    ...aiModelByProfile(PROFILE),
    schema: QuestionSchema,
    prompt,
  })

  return result.object.questions
}

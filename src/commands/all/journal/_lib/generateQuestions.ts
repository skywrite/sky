import { generateObject } from 'ai'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { aiModelByProfile, ROLES } from '#shared/ai/models.ts'
import type { JournalContext } from './gatherContext.ts'
import type { JournalType } from '#shared/models/Journal/type.d.ts'

const PROFILE = ROLES.reasoning
const PROMPT_FILE = new URL('../prompts/generate-questions.prompt.md', import.meta.url).pathname
const TYPE_PROMPT_FILE = new URL('../prompts/generate-type-questions.prompt.md', import.meta.url).pathname

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

/**
 * Generate goal-linked questions for specific journal types.
 *
 * Used to fill "AI-only" types — those whose questions file has no static
 * questions. Each question ties a concrete action to a goal found in the context.
 */
export async function generateQuestionsForTypes(
  types: JournalType[],
  context: JournalContext,
): Promise<GeneratedQuestion[]> {
  if (types.length === 0) return []

  const promptContent = await readTextFile(TYPE_PROMPT_FILE)
  const { output: prompt } = renderPromptFile(promptContent, 'generate-type-questions.prompt.md', {
    journal: {
      date: context.today.date,
      dayOfWeek: context.today.dayOfWeek,
      time: context.today.time,
      timeOfDay: context.today.timeOfDay,
      contextMarkdown: context.contextMarkdown,
      types: types.join(', '),
    },
  })

  const result = await generateObject({
    ...aiModelByProfile(PROFILE),
    schema: QuestionSchema,
    prompt,
  })

  // With a single requested type, attribute every question to it (the model
  // occasionally returns a near-miss type string). With multiple, trust the
  // model's assignment but drop anything outside the requested set.
  if (types.length === 1) {
    return result.object.questions.map((q) => ({ type: types[0], question: q.question }))
  }
  const wanted = new Set<JournalType>(types)
  return result.object.questions.filter((q) => wanted.has(q.type as JournalType))
}

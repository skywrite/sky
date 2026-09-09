import { generateObject } from 'ai'
import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { writingVoiceModel } from './model.ts'
import {
  CompactionSchema,
  LessonSchema,
  MAX_WRITING_CHARS,
  QuestionSchema,
  type VoiceCompaction,
  type VoiceDraftInput,
  type VoiceExample,
  type VoiceLesson,
  type VoiceQuestion,
} from './types.ts'

export interface VoiceIntelligence {
  draft: (
    input: VoiceDraftInput & { rules: string; lessons: VoiceLesson[]; examples: VoiceExample[] },
  ) => Promise<string>
  question: (example: VoiceExample) => Promise<VoiceQuestion>
  learn: (example: VoiceExample) => Promise<VoiceLesson>
  compact: (rules: string, examples: VoiceExample[]) => Promise<VoiceCompaction>
}

const PROMPTS = {
  draft: new URL('./prompts/draft.prompt.md', import.meta.url).pathname,
  question: new URL('./prompts/question.prompt.md', import.meta.url).pathname,
  learn: new URL('./prompts/learn.prompt.md', import.meta.url).pathname,
  compact: new URL('./prompts/compact.prompt.md', import.meta.url).pathname,
}

export function createVoiceIntelligence(model: () => ResolvedModel = writingVoiceModel): VoiceIntelligence {
  async function ask<T>(kind: keyof typeof PROMPTS, schema: z.ZodType<T>, input: unknown): Promise<T> {
    const file = PROMPTS[kind]
    const result = await generateObject({
      ...model(),
      schema,
      instructions: renderPromptFile(await readPromptFile(file), file, {}).output,
      prompt: JSON.stringify(input),
      abortSignal: AbortSignal.timeout(120_000),
    })
    return result.object
  }
  return {
    draft: async (input) =>
      (await ask('draft', z.object({ draft: z.string().min(1).max(MAX_WRITING_CHARS) }), input)).draft,
    question: (example) => ask('question', QuestionSchema, example),
    learn: (example) => ask('learn', LessonSchema, example),
    compact: (rules, examples) => ask('compact', CompactionSchema, { rules, examples }),
  }
}

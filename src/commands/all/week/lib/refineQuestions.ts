import * as path from 'node:path'
import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/render.ts'
import { Week } from '#universal/dates/nbdt/mod.ts'
import { buildPlanUserPrompt, type InterviewAnswers } from './draftWeek.ts'
import type { PlanContext } from './planContext.ts'
import type { Priority } from './weekMarkdown.ts'

const PROMPT_FILE = path.join(import.meta.dir, '..', 'prompts', 'refine.prompt.md')

const MAX_QUESTIONS = 6

/** One question per line; tolerate stray numbering/bullets; cap the count. */
export function parseRefineQuestions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 200)
    .slice(0, MAX_QUESTIONS)
}

/**
 * Context-aware follow-ups asked between the gather and the draft. Empty on
 * any failure or when the model has nothing to ask — refining never blocks.
 */
export async function generateRefineQuestions(args: {
  week: Week
  priorities: Priority[]
  context: PlanContext
  answers: InterviewAnswers
  createdYmd: string
}): Promise<string[]> {
  try {
    const { output: system } = renderPromptFile(await readTextFile(PROMPT_FILE), 'refine.prompt.md')
    const result = await generateText({ ...aiModel('reasoning'), system, prompt: buildPlanUserPrompt(args) })
    return parseRefineQuestions(result.text)
  } catch {
    return []
  }
}

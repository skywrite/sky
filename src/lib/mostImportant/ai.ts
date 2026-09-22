import { streamObject } from 'ai'
import { z } from 'zod'
import { gatherContext } from '#commands/all/mi/_lib/gatherContext.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile, type RenderInput } from '#shared/prompts/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { MAX_MI_QUESTIONS, type MostImportantAI, type MISuggestion, type MIProgressReporter } from './types.ts'

const promptFile = (name: string) =>
  new URL(`../../commands/all/mi/prompts/${name}.prompt.md`, import.meta.url).pathname
const text = z.string().trim().min(1)
const Suggestions = z.object({
  contextSummary: z.string().max(240).describe('One short sentence of background, shown only on request'),
  suggestions: z
    .array(
      z.object({
        summary: text
          .max(100)
          .describe('Short action title, ideally 5–10 words. Put the reason in reason, not the title.'),
        reason: text.max(160).describe('One short sentence: the strongest reason this deserves attention today'),
      }),
    )
    .max(5),
})
const Question = z.object({
  question: text
    .max(200)
    .nullable()
    .describe(
      'One brief scope, audience, or completion question. Null if the task is clear or answering would require doing the work.',
    ),
})
const summary = text
  .max(100)
  .describe(
    'Short action title, ideally 5–10 words. Name the action and deliverable; keep explanation, constraints, and substeps out.',
  )
const Draft = z.object({
  summary,
  dueBy: z.string().nullable().describe('Only an explicitly established deadline; never a scheduled start time'),
  body: text.describe(
    'Readable Markdown beneath the title: what to accomplish, why it matters in this situation, and what done means. Preserve useful context and explicit boundaries without repeating the source material or doing the task.',
  ),
})

async function render(name: string, input: RenderInput): Promise<string> {
  return renderPromptFile(await readPromptFile(promptFile(name)), `${name}.prompt.md`, input).output
}

async function generate<T>(schema: z.ZodType<T>, prompt: string, progress?: MIProgressReporter): Promise<T> {
  const result = streamObject({ ...aiModel('reasoning'), schema, prompt, onError: () => {} })
  let receiving = false
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error
    if (!receiving && part.type === 'object') {
      receiving = true
      progress?.({ stage: 'writing' })
    }
  }
  return await result.object
}

export async function miSuggestionsPrompt(
  day: PlainDate,
  options: { previous?: MISuggestion[]; feedback?: string; time?: string } = {},
  progress?: MIProgressReporter,
): Promise<string> {
  progress?.({ stage: 'context' })
  const context = await gatherContext(day, options.time)
  progress?.({ stage: 'thinking', documents: context.documentCount })
  return render('suggest-mi', {
    context: { notebookDate: day.ymd },
    user: {
      dayOfWeek: day.dayLong,
      dayContext: context.contextMarkdown,
      todayMIs: context.todayMIs.join('\n'),
      previous: JSON.stringify(options.previous ?? []),
      feedback: options.feedback ?? '',
    },
  })
}

/** Stateless steps shared by the terminal and day page. Only accepting the draft writes a notebook file. */
export function createMostImportantAI(): MostImportantAI {
  return {
    async enrich(draft) {
      const framing = { mediums: ['journal'], kind: 'most important item (daily focus)', maxTags: 5 }
      const input = { summary: draft.summary, body: draft.body }
      const [tags, rel] = await Promise.all([autoTagMessage(input, framing), autoRelMessage(input, framing)])
      return { tags: tags ?? undefined, rel: rel ?? undefined }
    },
    async suggest(day, options = {}, progress) {
      const result = await generate(Suggestions, await miSuggestionsPrompt(day, options, progress), progress)
      const seen = new Set((options.previous ?? []).map((item) => item.summary.toLowerCase().trim()))
      return {
        contextSummary: result.contextSummary,
        suggestions: result.suggestions.filter((item) => {
          const key = item.summary.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }),
      }
    },
    async question(day, input, progress) {
      if (input.answers.length >= MAX_MI_QUESTIONS) return null
      progress?.({ stage: 'context' })
      const context = await gatherContext(day)
      progress?.({ stage: 'thinking', documents: context.documentCount })
      const result = await generate(
        Question,
        await render('mi-clarifier', {
          clarifier: {
            currentInput: input.statement,
            conversationHistory: JSON.stringify(input.answers),
            notebookContext: context.contextMarkdown,
            day: day.ymd,
          },
        }),
        progress,
      )
      return result.question
    },
    async draft(day, input, progress) {
      progress?.({ stage: 'context' })
      const context = await gatherContext(day)
      progress?.({ stage: 'thinking', documents: context.documentCount })
      const prompt = await render('mi-synthesizer', {
        synthesizer: {
          statement: input.statement,
          conversation: JSON.stringify(input.answers),
          notebookContext: context.contextMarkdown,
          day: day.ymd,
          previous: input.previous ? JSON.stringify(input.previous) : undefined,
          feedback: input.feedback,
        },
      })
      const draft = await generate(Draft, prompt, progress)
      return { ...draft, dueBy: draft.dueBy ?? '' }
    },
  }
}

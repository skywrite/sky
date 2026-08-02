import { generateObject } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

const PROMPT_FILE = new URL('../prompts/parse-corrections.prompt.md', import.meta.url).pathname

const CorrectionsSchema = z.object({
  from: z.string().nullable().optional().describe('Updated from field, only if user changed it'),
  to: z.string().nullable().optional().describe('Updated to field, only if user changed it'),
  medium: z.string().optional().describe('Updated medium, only if user changed it'),
  summary: z.string().optional().describe('Updated summary, only if user changed it'),
  when: z
    .string()
    .optional()
    .describe(
      'Updated time as "YYYY-MM-DD HH:MM" if date changed, or just "HH:MM" if only time changed. ' +
        'Hours are not capped at 23 — copy extended hours like "25:30" through verbatim, never normalized',
    ),
  senderRenames: z
    .array(
      z.object({
        from: z.string().describe('Exact current sender name from the dialogue sender list'),
        to: z.string().describe('New name for this sender'),
      }),
    )
    .optional()
    .describe('Dialogue sender renames, only if the user renamed people'),
})

export type ParsedCorrections = z.infer<typeof CorrectionsSchema>

export interface CorrectionsContext {
  from?: string
  to?: string
  medium?: string
  summary?: string
  when: string
  senders: string[]
  corrections: string
}

export async function parseCorrections(ctx: CorrectionsContext): Promise<ParsedCorrections> {
  const promptContent = await readTextFile(PROMPT_FILE)
  const renderInput: RenderInput = {
    user: {
      from: ctx.from ?? 'null',
      to: ctx.to ?? 'null',
      medium: ctx.medium ?? 'null',
      summary: ctx.summary ?? 'null',
      when: ctx.when,
      senders: ctx.senders.length > 0 ? ctx.senders.join(', ') : '(none)',
      corrections: ctx.corrections,
    },
  }
  const { output: prompt } = renderPromptFile(promptContent, 'parse-corrections.prompt.md', renderInput)

  const result = await generateObject({
    ...aiModel('balanced'),
    schema: CorrectionsSchema,
    prompt,
  })

  return result.object
}

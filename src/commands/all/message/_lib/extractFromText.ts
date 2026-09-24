/**
 * A conversation read out of its text — a thread dragged or copied out of a
 * messaging app, or an app's export — into the shape a screenshot of it
 * gives: the platform, who wrote first and to whom, when, and every message
 * in order. Nothing is collapsed: text has no overlapping screenshots, so a
 * message that appears twice was sent twice.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { type ExtractOptions, MessageSchema } from './extractFromImage.ts'

const PROMPT_FILE = new URL('../prompts/extract-from-text.prompt.md', import.meta.url).pathname

const TextExtractionSchema = z.object({
  platform: z
    .string()
    .nullable()
    .describe(
      'Messaging platform the text came from (e.g. WhatsApp, iMessage, Signal, Telegram, Slack, Discord, Teams), when its layout or its words say so. Null if unclear.',
    ),
  from: z
    .string()
    .nullable()
    .describe('Who the conversation is from: the sender of its first message. Null if unclear.'),
  to: z
    .string()
    .nullable()
    .describe(
      'Who that first message was written to — the other party, or "Me" when the conversation opens incoming. Null if unclear.',
    ),
  summary: z
    .string()
    .describe(
      'What the conversation is about, 5-15 words. Substance only — the participants are recorded in separate ' +
        'fields, so do not name the sender or recipient and do not narrate who told whom.',
    ),
  when: z
    .string()
    .nullable()
    .describe(
      'When the conversation took place, as "YYYY-MM-DD HH:MM". Take the clock from the first message\'s ' +
        'timestamp in the text — an absolute clock as written, in 24-hour time; a relative one ("Now", ' +
        '"5 min ago") resolved against the filing time given in the prompt — and its date from the text\'s date ' +
        'line or relative label ("Today", "Yesterday") against that same filing time. Null if the text carries ' +
        'no timestamp.',
    ),
  messages: z
    .array(MessageSchema)
    .describe(
      "Every message in the text, in order, each exactly once. Read receipts, reactions and the app's own labels are not messages.",
    ),
  continuityNotes: z
    .string()
    .nullable()
    .describe(
      'Text that could not be read as messages, or an order that is unclear, in one or two sentences. Null if the text reads cleanly.',
    ),
})

export type TextExtraction = z.infer<typeof TextExtractionSchema>

export async function extractMessageFromText(
  text: string,
  { aiContext, now }: ExtractOptions = {},
): Promise<TextExtraction> {
  const promptContent = await readPromptFile(PROMPT_FILE)
  let { output: prompt } = renderPromptFile(promptContent, 'extract-from-text.prompt.md', {
    user: { now: now ?? '(unknown)' },
  })
  if (aiContext) {
    prompt += `\n\nAdditional context: ${aiContext}`
  }

  // The conversation first and the instructions after it: a long text reads
  // better with the question at the end.
  const result = await generateObject({
    ...aiModel('reasoning'),
    schema: TextExtractionSchema,
    prompt: `<conversation>\n${text}\n</conversation>\n\n${prompt}`,
  })
  return result.object
}

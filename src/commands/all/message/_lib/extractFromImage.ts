import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { loadImageForAI } from './loadImage.ts'

const PROMPT_FILE = new URL('../prompts/extract-from-image.prompt.md', import.meta.url).pathname

const MessageSchema = z.object({
  sender: z
    .string()
    .describe(
      'Sender name: the name shown next to the message, the chat header name for the other party in a 1:1 chat, or a name from the additional context. Outgoing messages with no known name are "Me" — never placeholders like "Person 1".',
    ),
  text: z.string().describe('Message text, verbatim'),
  time: z
    .string()
    .nullable()
    .describe(
      'Timestamp for this message as "HH:MM", or "YYYY-MM-DD HH:MM" when it falls on a different day than the ' +
        'conversation as a whole. Copy the wall clock exactly as displayed and resolve any relative label ' +
        '("Today", "Yesterday") against the reference date. Null if this message carries no visible timestamp.',
    ),
})

const ExtractionSchema = z.object({
  platform: z
    .string()
    .nullable()
    .describe(
      'Messaging platform (e.g. WhatsApp, iMessage, Signal, Telegram, Slack, Discord, Teams). Null if unclear.',
    ),
  from: z.string().nullable().describe('Who sent the message(s). Null if unclear.'),
  to: z.string().nullable().describe('Who received the message(s). Null if unclear.'),
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
      'When the conversation took place, as "YYYY-MM-DD HH:MM". Take the wall clock from the first message\'s ' +
        'visible timestamp exactly as displayed, and resolve its date from the date separator or relative label ' +
        '("Today", "Yesterday") against the reference date given in the prompt. Null if no timestamp is visible.',
    ),
  messages: z
    .array(MessageSchema)
    .describe(
      'Every message across all screenshots in chronological order. A message appearing in multiple overlapping screenshots must be included only once.',
    ),
  continuityNotes: z
    .string()
    .nullable()
    .describe(
      'Suspected gaps between screenshots or uncertain ordering, in one or two sentences. Null if the reconstructed stream is continuous and unambiguous.',
    ),
})

export type ExtractedMessage = z.infer<typeof MessageSchema>

export interface ImageExtraction {
  platform: string | null
  from: string | null
  to: string | null
  summary: string
  when: string | null
  messages: ExtractedMessage[]
  continuityNotes: string | null
}

export interface ExtractOptions {
  /** Extra guidance for the model — known participants, user-supplied --ai-context. */
  aiContext?: string
  /**
   * `YYYY-MM-DD` the screenshots are being filed under, used to resolve "Today"
   * and "Yesterday". Passed in rather than read from a clock here; for a
   * screenshot captured on an earlier day those labels resolve to the filing
   * date, which the corrections prompt can fix.
   */
  referenceDate?: string
}

export interface SenderRename {
  from: string
  to: string
}

export function renameSenders(messages: ExtractedMessage[], renames: SenderRename[]): ExtractedMessage[] {
  const map = new Map(renames.map((r) => [r.from, r.to]))
  return messages.map((m) => {
    const to = map.get(m.sender)
    return to === undefined ? m : { ...m, sender: to }
  })
}

/** e.g. "Sarah ×6, Me ×4" — distinct senders in order of first appearance */
export function senderSummary(messages: ExtractedMessage[]): string {
  const counts = new Map<string, number>()
  for (const m of messages) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1)
  return [...counts].map(([name, n]) => `${name} ×${n}`).join(', ')
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Safety net for imperfect overlap merging by the model: drop a message that
 * repeats the immediately preceding one. Only adjacent repeats are dropped —
 * the same text sent again later in a conversation is legitimate. Repeats with
 * two different visible timestamps are kept (a genuine double-send).
 */
export function collapseAdjacentDuplicates(messages: ExtractedMessage[]): ExtractedMessage[] {
  const result: ExtractedMessage[] = []
  for (const m of messages) {
    const prev = result[result.length - 1]
    const isDuplicate =
      prev !== undefined &&
      prev.sender === m.sender &&
      normalizeText(prev.text) === normalizeText(m.text) &&
      (prev.time === null || m.time === null || prev.time === m.time)
    if (!isDuplicate) result.push(m)
  }
  return result
}

/**
 * Messaging apps stamp only some messages in a run, so a timestamp is appended
 * where the screenshot showed one and omitted otherwise — an invented time on
 * every line would read as precision the screenshot did not have.
 */
export function renderDialogue(messages: ExtractedMessage[]): string {
  return messages.map((m) => `**${m.sender}:**${m.time ? ` (${m.time})` : ''} ${m.text}`).join('\n\n')
}

export async function extractMessageFromImage(
  imagePaths: string[],
  { aiContext, referenceDate }: ExtractOptions = {},
): Promise<ImageExtraction> {
  const imageBlocks = await Promise.all(
    imagePaths.map(async (p) => {
      const { image, mediaType } = await loadImageForAI(p)
      return { type: 'file' as const, data: image, mediaType }
    }),
  )

  const promptContent = await readTextFile(PROMPT_FILE)
  let { output: prompt } = renderPromptFile(promptContent, 'extract-from-image.prompt.md', {
    user: { referenceDate: referenceDate ?? '(unknown)' },
  })
  if (aiContext) {
    prompt += `\n\nAdditional context: ${aiContext}`
  }

  const result = await generateObject({
    ...aiModel('reasoning'),
    schema: ExtractionSchema,
    messages: [
      {
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  })

  const { messages, ...rest } = result.object
  return { ...rest, messages: collapseAdjacentDuplicates(messages) }
}

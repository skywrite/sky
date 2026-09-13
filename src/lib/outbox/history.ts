import { generateObject } from 'ai'
import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { hash } from './files.ts'
import { outboxModel, OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'
import type { Conversation } from './types.ts'

// Count serialized source text, including escaping and metadata, rather than
// assuming that a file count or a number of hours bounds the model input.
export const HISTORY_SOURCE_CHARS = 60_000
const PART_CHARS = 12_000
const PROMPT = new URL('./prompts/history.prompt.md', import.meta.url).pathname
const HistoryNotes = z.object({
  notes: z.string().trim().min(1).max(12_000),
  evidence: z.array(z.object({ ref: z.string().max(2000), quote: z.string().min(1).max(2000) })).max(8),
})
type Notes = z.infer<typeof HistoryNotes>
type Source = Conversation['sources'][number]
export type HistoryExcerpt = Source & {
  span: { start: number; end: number }
  heading?: string
  message: { key: string; at: string | null; offset: number }
}
type Excerpt = HistoryExcerpt

function minute(value: string): string {
  return PlainDateTime.fromString(value).normalize().toString()
}

function markers(source: Source, medium: Conversation['medium']) {
  if (medium === 'Slack')
    return parseSlackConversation(source.body).messages.map(({ start, timestamp, heading, id, author }) => ({
      start,
      time: minute(timestamp),
      heading,
      key: id ? `Slack:${id}` : `Slack:${hash(JSON.stringify([minute(timestamp), author]))}`,
    }))
  // Match the same saved email headings used by discovery. All other text is
  // retained as context, including preambles, quoted mail and attachments.
  return [...source.body.matchAll(/^## (\d{4}-\d{2}-\d{2} \d{1,2}:\d{2})[^\n]*\*\*[^\n]*/gm)].map((match) => ({
    start: match.index,
    time: minute(match[1]),
    heading: match[0],
    key: `Email:${hash(JSON.stringify([minute(match[1]), match[0].replace(/^#+\s*/, '')]))}`,
  }))
}

function safeEnd(text: string, end: number): number {
  const code = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  return code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end
}

/** Every source character survives in an excerpt; only model inputs are split. */
export function conversationChunks(conversation: Conversation): Excerpt[][] {
  const excerpts: { time: string; source: Excerpt }[] = []
  for (const source of conversation.sources) {
    const headings = markers(source, conversation.medium)
    const firstTime = headings[0]?.time ?? source.times?.map(minute).sort()[0] ?? `${source.ref.slice(0, 10)} 00:00`
    const sections: { start: number; time: string; heading?: string; key?: string }[] =
      headings[0]?.start === 0 ? headings : [{ start: 0, time: firstTime }, ...headings]
    for (const [index, section] of sections.entries()) {
      const stop = sections[index + 1]?.start ?? source.body.length
      let start = section.start
      do {
        let end = Math.min(start + PART_CHARS, stop)
        if (end < stop) {
          const newline = source.body.lastIndexOf('\n', end - 1)
          if (newline > start + PART_CHARS / 2) end = newline + 1
        }
        end = safeEnd(source.body, end)
        const excerpt = (): Excerpt => ({
          ref: source.ref,
          hash: source.hash,
          from: source.from,
          to: source.to,
          body: source.body.slice(start, end),
          times: [section.time],
          span: { start, end },
          message: {
            key: section.key ?? `capture:${source.ref}`,
            at: section.key
              ? section.time
              : headings.length === 0 && source.times?.length === 1
                ? minute(source.times[0])
                : null,
            offset: start - section.start,
          },
          ...(section.heading ? { heading: section.heading } : {}),
        })
        let part = excerpt()
        while (JSON.stringify([part]).length > HISTORY_SOURCE_CHARS) {
          const next = safeEnd(source.body, start + Math.floor((end - start) / 2))
          if (next <= start) throw new Error('Saved message metadata is too large to read in a history chunk.')
          end = next
          part = excerpt()
        }
        excerpts.push({ time: section.time, source: part })
        start = end
      } while (start < stop)
    }
  }
  // Filing dates can differ from message dates. Keep split pieces of one
  // message together, even when another capture has the same timestamp.
  excerpts.sort(
    (a, b) =>
      a.time.localeCompare(b.time) ||
      a.source.ref.localeCompare(b.source.ref) ||
      a.source.span.start - b.source.span.start,
  )
  const chunks: Excerpt[][] = []
  let chunk: Excerpt[] = []
  let size = 2
  for (const { source } of excerpts) {
    const length = JSON.stringify(source).length
    if (size + length + (chunk.length ? 1 : 0) > HISTORY_SOURCE_CHARS) {
      chunks.push(chunk)
      chunk = []
      size = 2
    }
    size += length + (chunk.length ? 1 : 0)
    chunk.push(source)
  }
  if (chunk.length) chunks.push(chunk)
  return chunks
}

/** Read earlier chunks before the ordinary final judgment sees the last one. */
export async function prepareConversationHistory(
  conversation: Conversation,
  context: Record<string, unknown>,
  model: () => ResolvedModel = outboxModel,
): Promise<{
  conversation: Conversation
  history?: Notes & { summarizedParts: number; totalParts: number }
}> {
  if (JSON.stringify(conversation.sources).length <= HISTORY_SOURCE_CHARS) return { conversation }
  const chunks = conversationChunks(conversation)
  const instructions = renderPromptFile(await readPromptFile(PROMPT), PROMPT, {}).output
  let previous: Notes = { notes: '', evidence: [] }
  for (let index = 0; index < chunks.length - 1; index++) {
    const sources = chunks[index]
    const result = await generateObject({
      ...model(),
      schema: HistoryNotes,
      instructions,
      prompt: JSON.stringify({
        context,
        conversation: { ...conversation, sources },
        previous,
        part: index + 1,
        totalParts: chunks.length,
      }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    for (const evidence of result.object.evidence) {
      const seen =
        evidence.quote.trim() &&
        [...sources, ...previous.evidence.map(({ ref, quote }) => ({ ref, body: quote }))].some(
          (source) => source.ref === evidence.ref && source.body.includes(evidence.quote),
        )
      if (!seen)
        throw new Error('A history note cited a reply that was not found in the reviewed messages. Check again.')
    }
    previous = result.object
  }
  return {
    conversation: { ...conversation, sources: chunks.at(-1)! },
    history: { ...previous, summarizedParts: chunks.length - 1, totalParts: chunks.length },
  }
}

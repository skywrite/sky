import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import truncate from '#shared/strings/truncate.ts'
import { SLACK_ENRICH } from './enrich.ts'

export { cleanSummary } from '#lib/notebook/enrich/summarize.ts'

type MessageLike = { text: string; userName?: string; userId?: string }

const MAX_TRANSCRIPT_CHARS = 8000
const MAX_SUMMARY_CHARS = 80

/**
 * Summarize a Slack message and its thread replies in 5-7 words, for use in
 * filenames and follow summaries.
 *
 * Replies are part of the input because the root message is often just a
 * header ("July 10th Integration Update (in 🧵)") with the substance in the
 * thread. The shared summarizer rejects a model reply that isn't a usable
 * label; on that or a model error, falls back to the first line of the first
 * non-empty message.
 *
 * Returns undefined when there is no text to summarize at all.
 */
export async function summarizeSlackMessage(
  message: MessageLike,
  replies: MessageLike[] = [],
): Promise<string | undefined> {
  const transcript = buildTranscript(message, replies)
  if (!transcript) return undefined
  const summary = await summarizeTranscript(transcript, { kind: SLACK_ENRICH.kind })
  return summary ?? fallbackSummary(message, replies)
}

/** Speaker-labeled transcript of root message + replies, capped for the prompt. Empty string when no message has text. */
export function buildTranscript(message: MessageLike, replies: MessageLike[] = []): string {
  const lines: string[] = []
  for (const m of [message, ...replies]) {
    const text = m.text?.trim()
    if (!text) continue
    lines.push(`${m.userName || m.userId || '-'}: ${text}`)
  }
  return truncate(lines.join('\n\n'), MAX_TRANSCRIPT_CHARS)
}

/** First line of the first non-empty message, truncated — used when the model reply is unusable. */
export function fallbackSummary(message: MessageLike, replies: MessageLike[] = []): string | undefined {
  for (const m of [message, ...replies]) {
    const text = m.text?.trim()
    if (!text) continue
    return truncate(text.split('\n')[0].trim(), MAX_SUMMARY_CHARS)
  }
  return undefined
}

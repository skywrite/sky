import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import type { EmailMessage } from './imap-client.ts'
import { sanitizeEmailHtml } from './sanitizeEmailHtml.ts'

const PROMPT_FILE = new URL('../../../all/follow/email/prompts/email-to-markdown.prompt.md', import.meta.url).pathname

/** Extract the text/plain part from a raw RFC 2822 email source */
export function extractPlainText(raw: string): string {
  // Strip headers
  let body = raw
  const rnrn = raw.indexOf('\r\n\r\n')
  if (rnrn !== -1) body = raw.slice(rnrn + 4)
  else {
    const nn = raw.indexOf('\n\n')
    if (nn !== -1) body = raw.slice(nn + 2)
  }

  // Extract boundary from Content-Type header
  const boundaryMatch = raw.match(/boundary="?([^"\r\n]+)"?/i)
  if (!boundaryMatch) {
    // Not multipart — return body as-is
    return body
  }

  const boundary = boundaryMatch[1]
  const parts = body.split(`--${boundary}`)

  // Find the text/plain part
  for (const part of parts) {
    if (/Content-Type:\s*text\/plain/i.test(part)) {
      // Strip the part's headers
      const partRnrn = part.indexOf('\r\n\r\n')
      if (partRnrn !== -1) return part.slice(partRnrn + 4).trim()
      const partNn = part.indexOf('\n\n')
      if (partNn !== -1) return part.slice(partNn + 2).trim()
    }
  }

  // Fallback: return the full body
  return body
}

export async function emailToMarkdown(
  msg: EmailMessage,
  opts?: { priorMessages?: string[] },
): Promise<{ markdown: string; truncated: boolean }> {
  if (!msg.bodyText && !msg.bodyHtml) return { markdown: '', truncated: false }

  // Prefer HTML (authoritative in Gmail) over text/plain (auto-generated, often incomplete)
  const body = msg.bodyHtml ? sanitizeEmailHtml(msg.bodyHtml) : msg.bodyText
  const plainText = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  // Rail against absurd inputs (~34k tokens of prose); the finishReason check
  // below catches the rare output-side clip on token-dense content.
  const maxChars = 128000
  const inputTruncated = plainText.length > maxChars
  const capped = inputTruncated ? plainText.slice(0, maxChars) + '\n...(truncated)' : plainText

  const now = new Date()
  const tz = currentTimezoneIANA()
  const currentTime = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)} ${tz}`

  // Build thread context for deduplication
  const priorContext = opts?.priorMessages?.length
    ? `\n\nThe following messages from this thread have ALREADY been saved. Strip any content that duplicates what is already captured below — only include what is new in this message.\n\n<prior_messages>\n${opts.priorMessages.join(
        '\n---\n',
      )}\n</prior_messages>\n`
    : ''

  // AI failures propagate: the caller skips the message and leaves its thread
  // in the inbox, so the next sync retries the conversion from scratch.
  const promptContent = await readTextFile(PROMPT_FILE)
  const renderInput: RenderInput = {
    email: { body: capped, currentTime, priorContext },
  }
  const { output: prompt } = renderPromptFile(promptContent, 'email-to-markdown.prompt.md', renderInput)

  const { text, finishReason } = await generateText({
    ...aiModel('balanced'),
    prompt,
  })

  // Strip any WHEN: line the AI might still include (no longer used for timestamps)
  const lines = text.trim().split('\n')
  const cleaned = lines[0]?.match(/^WHEN:\s*/) ? lines.slice(1).join('\n').trim() : text.trim()

  // 'length' = generation stopped at the output-token ceiling — the tail of
  // the source never made it into the conversion.
  const truncated = inputTruncated || finishReason === 'length'
  const markdown = truncated
    ? `${cleaned}\n\n*(capture truncated — the source email exceeded the conversion budget)*`
    : cleaned
  return { markdown, truncated }
}

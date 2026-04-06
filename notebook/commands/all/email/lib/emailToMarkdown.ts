import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { readTextFile } from '#shared/fs/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { EmailMessage } from './imap-client.ts'

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
): Promise<{ markdown: string }> {
  if (!msg.bodyText && !msg.bodyHtml) return { markdown: '' }

  // Prefer HTML (authoritative in Gmail) over text/plain (auto-generated, often incomplete)
  const body = msg.bodyHtml ?? msg.bodyText
  const plainText = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const maxChars = 12000
  const truncated = plainText.length > maxChars ? plainText.slice(0, maxChars) + '\n...(truncated)' : plainText

  const now = new Date()
  const tz = currentTimezoneIANA()
  const currentTime = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)} ${tz}`

  // Build thread context for deduplication
  const priorContext = opts?.priorMessages?.length
    ? `\n\nThe following messages from this thread have ALREADY been saved. Strip any content that duplicates what is already captured below — only include what is new in this message.\n\n<prior_messages>\n${opts.priorMessages.join(
        '\n---\n',
      )}\n</prior_messages>\n`
    : ''

  try {
    const promptContent = await readTextFile(PROMPT_FILE)
    const renderInput: RenderInput = {
      email: { body: truncated, currentTime, priorContext },
    }
    const { output: prompt } = renderPromptFile(promptContent, 'email-to-markdown.prompt.md', renderInput)

    const { text } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      prompt,
    })

    // Strip any WHEN: line the AI might still include (no longer used for timestamps)
    const lines = text.trim().split('\n')
    if (lines[0]?.match(/^WHEN:\s*/)) {
      return { markdown: lines.slice(1).join('\n').trim() }
    }
    return { markdown: text.trim() }
  } catch {
    return { markdown: plainText.slice(0, 2000) }
  }
}

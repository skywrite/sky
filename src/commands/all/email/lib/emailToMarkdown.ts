import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { EmailMessage } from './imap-client.ts'
import { sanitizeEmailHtml } from './sanitizeEmailHtml.ts'

const PROMPT_FILE = new URL('../prompts/email-to-markdown.prompt.md', import.meta.url).pathname

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

// The conversion reproduces the source roughly 1:1, so output size tracks
// input size. Two ceilings shape it, and neither loses content any more.
//
// Input: every call must fit the model's 200k context — which the reserved
// output ALSO counts against, and a continuation round carries body + priors
// + output so far + the 64k reserve at once: ~40k + ~30k + ~40k + 64k ≈ 174k,
// with margin for token-dense content. So 128k chars is the most one call can
// carry. A larger source is not truncated to it — it is CUT INTO windows of
// it and converted in sequence, because an over-context call doesn't
// truncate, it errors, and the caller's retry loop would refetch the same
// failure forever.
//
// Output: a generation that stops at the token ceiling is resumed until it
// ends naturally. Not by assistant prefill — Claude 5 models reject a
// conversation ending in an assistant message — but by handing the model its
// own partial output as a prior turn and asking it to continue from the exact
// stop point, with an overlap-stripping stitch in case it re-speaks the tail.
export const MAX_INPUT_CHARS = 128_000
const MAX_PRIOR_CHARS = 100_000
const MAX_OUTPUT_TOKENS = 64_000
/** Loop brake, not a budget — one window finishes in 1-2 rounds. */
const MAX_ROUNDS = 4
/**
 * Per-call abort: a 64k-token window legitimately generates for minutes, but a
 * wedged connection would otherwise hang a sync forever — and on the
 * heartbeat, wedge the tick guard with it, killing all heartbeat activity
 * until the 12-hour process recycle. AI failures propagate to the caller's
 * fail-and-retry, so a timeout costs one thread one run, never the capture.
 */
const CALL_TIMEOUT_MS = 10 * 60_000
/** Windows per email (~768k chars). Past this the capture is marked, not silently short. */
const MAX_WINDOWS = 6
/** How much of the text so far seeds the next window, so the seam reads as one voice. */
const SEAM_CHARS = 1_500

const CONTINUE_PROMPT =
  'Continue the conversion from exactly where your last message stopped — mid-sentence or mid-word if that is where it stopped. Output only the continuation: no preamble, and never repeat anything already written.'

/**
 * Append a continuation, stripping a re-spoken tail: models asked to continue
 * sometimes restart from a little before the stop point. The longest suffix
 * of what we have that prefixes the continuation is dropped from the latter —
 * bounded to the seam size, and never for trivially short matches, which are
 * likelier coincidence than repetition.
 */
export function stitchContinuation(soFar: string, continuation: string): string {
  const tail = soFar.slice(-SEAM_CHARS)
  const max = Math.min(tail.length, continuation.length)
  for (let len = max; len >= 12; len--) {
    if (continuation.startsWith(tail.slice(tail.length - len))) {
      return soFar + continuation.slice(len)
    }
  }
  return soFar + continuation
}

/**
 * Cut a body into windows no larger than `maxChars`, always at a line
 * boundary so no line — and no markup on it — is split in half. A single line
 * longer than the window is its own window rather than a hang.
 */
export function chunkBody(text: string, maxChars = MAX_INPUT_CHARS): string[] {
  if (text.length <= maxChars) return [text]
  const windows: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const lineBreak = text.lastIndexOf('\n', end)
      if (lineBreak > start) end = lineBreak + 1
    }
    windows.push(text.slice(start, end))
    start = end
  }
  return windows
}

/**
 * Newest priors first when the block must shrink: dedup needs the messages a
 * reply actually quotes, and those are the recent ones. Chronological order is
 * preserved in what survives.
 */
export function capPriorMessages(priors: string[], maxChars = MAX_PRIOR_CHARS): string[] {
  const kept: string[] = []
  let total = 0
  for (let i = priors.length - 1; i >= 0; i--) {
    total += priors[i].length
    if (total > maxChars && kept.length > 0) break
    kept.unshift(priors[i])
    if (total > maxChars) break
  }
  return kept
}

export async function emailToMarkdown(
  msg: EmailMessage,
  opts?: { priorMessages?: string[] },
): Promise<{ markdown: string; truncated: boolean; sourceChars: number }> {
  if (!msg.bodyText && !msg.bodyHtml) return { markdown: '', truncated: false, sourceChars: 0 }

  // Prefer HTML (authoritative in Gmail) over text/plain (auto-generated, often incomplete)
  const body = msg.bodyHtml ? sanitizeEmailHtml(msg.bodyHtml) : msg.bodyText
  const plainText = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const allWindows = chunkBody(plainText)
  const windows = allWindows.slice(0, MAX_WINDOWS)
  const overWindowCap = allWindows.length > MAX_WINDOWS

  // Build thread context for deduplication
  const priors = capPriorMessages(opts?.priorMessages ?? [])
  const priorContext = priors.length
    ? `\n\nThe following messages from this thread have ALREADY been saved. Strip only content that literally duplicates what is captured below (quoted repeats of earlier messages) — the sender's new content must still be reproduced word-for-word in full.\n\n<prior_messages>\n${priors.join(
        '\n---\n',
      )}\n</prior_messages>\n`
    : ''

  // AI failures propagate: the caller skips the message and leaves its thread
  // in the inbox, so the next sync retries the conversion from scratch.
  const promptContent = await readPromptFile(PROMPT_FILE)

  // Convert to completion, window by window. A generation that stops at the
  // output ceiling is resumed: the partial output goes back as a prior
  // assistant turn (never the trailing message — Claude 5 rejects prefill)
  // with a user turn asking to continue from the exact stop point, and the
  // stitcher strips any re-spoken tail. Across windows, the previous window's
  // closing lines ride in the prompt so the seam reads as one voice.
  let converted = ''
  let brakeTripped = false
  for (let index = 0; index < windows.length; index++) {
    const partNote =
      windows.length > 1
        ? `\n\nThis is part ${index + 1} of ${windows.length} of ONE email body, split only because of its length. Convert exactly the part below and nothing else: no preamble, no heading announcing the part, no closing remark. If everything in this part is removable (quoted repeats, signatures, disclaimers), output exactly the single word SKYEMPTY and nothing else. The parts are joined verbatim into one document.\n`
        : ''
    const seamNote =
      index > 0
        ? `\nThe conversion of the previous parts ends with:\n<previous_part_tail>\n${converted.slice(-SEAM_CHARS)}\n</previous_part_tail>\nContinue seamlessly from there — output only this part's conversion, never repeating the tail above.\n`
        : ''
    const renderInput: RenderInput = {
      email: { body: windows[index], priorContext: priorContext + partNote + seamNote },
    }
    const { output: prompt } = renderPromptFile(promptContent, 'email-to-markdown.prompt.md', renderInput)

    let part = ''
    let finishReason = ''
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const result = await generateText({
        ...aiModel('balanced'),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        messages: [
          { role: 'user' as const, content: prompt },
          ...(part
            ? [
                { role: 'assistant' as const, content: part },
                { role: 'user' as const, content: CONTINUE_PROMPT },
              ]
            : []),
        ],
      })
      part = part ? stitchContinuation(part, result.text) : result.text
      finishReason = result.finishReason
      if (finishReason !== 'length') break
    }
    // The all-removable sentinel: asking a model to output nothing gets a
    // narration of the nothing instead (live-proven, twice); asking for one
    // exact word works. Strip it here so an empty window contributes nothing.
    if (part.trim() === 'SKYEMPTY') part = ''
    converted = converted ? stitchContinuation(converted, part) : part
    // Any window still generating when the round brake tripped left a gap —
    // remember it, or a clean final window would erase the marker.
    if (finishReason === 'length') brakeTripped = true
  }

  const cleaned = converted.trim()

  // Only true pathology remains marked: a source past the window cap, or a
  // window still generating when the round brake tripped.
  const truncated = overWindowCap || brakeTripped
  const markdown = truncated
    ? `${cleaned}\n\n*(the tail of this email was too long to capture — the full thread is in Gmail)*`
    : cleaned
  return { markdown, truncated, sourceChars: plainText.length }
}

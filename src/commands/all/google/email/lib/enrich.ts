import truncate from '#shared/strings/truncate.ts'

/**
 * Corpus and framing for the summary, tags, and rel a first-time email capture
 * gets. `kind` is the noun the prompts use for what they are labeling, so an
 * email thread is never described to the model as a Slack conversation.
 *
 * The corpus is email only: the archived captures already carry a taxonomy of
 * their own, and a closed menu built from them offers nothing a past email was
 * not filed under.
 */
export const EMAIL_ENRICH: { mediums: string[]; kind: string } = {
  mediums: ['email'],
  kind: 'email thread',
}

const MAX_TRANSCRIPT_CHARS = 8000

export type TranscriptMessage = { from: string; markdown: string }

/**
 * Sender-labeled transcript of a thread's messages, capped for the prompt.
 * The subject leads: it is often the only statement of what the thread is
 * about, with the messages themselves reading as replies to it. Empty string
 * when no message has text.
 */
export function buildEmailTranscript(subject: string, messages: TranscriptMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    const text = message.markdown.trim()
    if (!text) continue
    parts.push(`${message.from}: ${text}`)
  }
  if (parts.length === 0) return ''
  const head = subject.trim() ? `Subject: ${subject.trim()}\n\n` : ''
  return truncate(head + parts.join('\n\n'), MAX_TRANSCRIPT_CHARS)
}

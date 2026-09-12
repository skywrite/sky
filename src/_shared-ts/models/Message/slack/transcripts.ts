import { Lexer } from 'marked'
import type { SlackMessage } from './parse.ts'

export const VOICE_TRANSCRIPT_LABEL = '*(voice memo transcript)*'

/** Markers belong to files, so multiple voice notes in one message remain independently retryable. */
export function voiceTranscriptMarker(attachmentId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(attachmentId)) throw new Error('Invalid voice memo attachment ID.')
  return `<!-- voice-memo-transcript:${attachmentId} -->`
}

export function voiceTranscriptIds(message: SlackMessage | undefined, voiceFileIds: readonly string[]): Set<string> {
  const ids = new Set<string>()
  if (!message) return ids
  let labels = 0
  for (const token of new Lexer().blockTokens(message.body.replace(/\r\n?/g, '\n'))) {
    const marker = token.type === 'html' && token.raw.trim().match(/^<!-- voice-memo-transcript:([a-zA-Z0-9_-]+) -->$/)
    if (marker) ids.add(marker[1])
    if (token.type === 'paragraph' && token.raw.trim() === VOICE_TRANSCRIPT_LABEL) labels++
  }
  if (labels > ids.size) {
    const remaining = voiceFileIds.filter((id) => !ids.has(id))
    const attached = remaining.filter((id) => message.attachmentIds.includes(id))
    const candidates = attached.length ? attached : remaining
    if (candidates.length === 1 && labels - ids.size === 1) ids.add(candidates[0])
    else if (candidates.length > 1)
      throw new Error('A manual voice memo transcript needs an attachment ID before more transcripts can be inserted.')
  }
  return ids
}

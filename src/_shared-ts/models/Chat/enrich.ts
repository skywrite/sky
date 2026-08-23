import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import truncate from '#shared/strings/truncate.ts'

/**
 * Corpus and framing for the tags and rel a chat transcript gets on save.
 *
 * The corpus is chats only: nearly every archived chat is hand-tagged, so the
 * saved transcripts carry a taxonomy of their own, and how past chats were
 * filed is the strongest guide for the next one. Chats have no conversation
 * identity (no `to:`), so the menu and the most recent archived chats stand
 * in for the per-conversation history other mediums key on.
 */
export const CHAT_ENRICH: { mediums: string[]; kind: string } = {
  mediums: ['chat'],
  kind: 'AI chat conversation',
}

// The classifier prompts keep only the head of an over-long body, and chat
// transcripts run far past that budget (the median archived chat is ~40k
// chars). Pack the signal instead: every turn appears, assistant essays are
// clipped harder than the owner's typed prompts, and when the whole still
// overflows, keep the opening and the ending — the topic is set early and
// concluded late — over the middle.
const MAX_TRANSCRIPT_CHARS = 8000
const USER_TURN_CHARS = 2000
const ASSISTANT_TURN_CHARS = 1200
const CLIP_MARK = ' […]'
const OMISSION_MARK = '\n\n[... middle omitted ...]\n\n'
const HEAD_SHARE = 0.6

/** Role-labeled transcript of a chat's turns, packed to the classifier budget. */
export function buildChatTranscript(messages: ConversationMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    // HTML comments are markup plumbing (pasted content, legacy markers), not conversation.
    const text = message.content.replace(/<!--[\s\S]*?-->/g, '').trim()
    if (!text) continue
    const cap = message.role === 'user' ? USER_TURN_CHARS : ASSISTANT_TURN_CHARS
    const label = message.role === 'user' ? 'User' : 'AI'
    parts.push(`${label}: ${truncate(text, cap, CLIP_MARK)}`)
  }
  const transcript = parts.join('\n\n')
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript

  const budget = MAX_TRANSCRIPT_CHARS - OMISSION_MARK.length
  const headChars = Math.floor(budget * HEAD_SHARE)
  const head = truncate(transcript, headChars)
  let tail = transcript.slice(transcript.length - (budget - headChars))
  // truncate() protects the head cut from splitting a surrogate pair; the
  // tail cut needs the mirror guard or an orphaned low surrogate leads the
  // tail and the model API rejects the request body.
  const first = tail.charCodeAt(0)
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1)
  return head + OMISSION_MARK + tail
}

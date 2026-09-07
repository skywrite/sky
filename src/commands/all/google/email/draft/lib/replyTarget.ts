/**
 * Where a reply goes: pure derivation of recipient, subject, and RFC
 * threading headers from a fetched Gmail thread. The command owns the
 * fetch and the draft write.
 */

import type { GmailAddress, GmailMessage } from '#lib/google/mod.ts'

export interface ReplyTarget {
  /** The message being replied to — the newest one not sent by the account itself. */
  to: GmailAddress[]
  subject: string
  inReplyTo?: string
  references?: string
}

/** RFC 5322 keeps References bounded in practice; the newest ids matter most. */
const MAX_REFERENCES = 10

/**
 * Pick what a reply answers: the newest message from someone other than
 * the account owner, falling back to the thread's newest message when the
 * owner spoke last (replying to one's own follow-up is still a reply).
 */
export function pickReplyTarget(messages: GmailMessage[], selfEmail: string): ReplyTarget | undefined {
  if (messages.length === 0) return undefined
  const self = selfEmail.toLowerCase()
  const others = messages.filter((m) => (m.from?.address ?? '').toLowerCase() !== self)
  const target = others.at(-1) ?? messages.at(-1)!

  const baseSubject = (target.subject || messages[0].subject || '').trim()
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`.trimEnd()

  const ids: string[] = []
  for (const message of messages) {
    if (message.messageId && !ids.includes(message.messageId)) ids.push(message.messageId)
  }
  // The replied-to id must close the chain even when it sits mid-thread.
  if (target.messageId) {
    const without = ids.filter((id) => id !== target.messageId)
    without.push(target.messageId)
    ids.length = 0
    ids.push(...without)
  }

  return {
    to: target.from?.address ? [target.from] : [],
    subject,
    inReplyTo: target.messageId,
    references: ids.slice(-MAX_REFERENCES).join(' ') || undefined,
  }
}

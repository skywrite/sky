/**
 * A thread the service went down answering.
 *
 * The crash snapshot is written as a turn begins, so a service that died
 * before the reply came leaves a conversation ending on the person's
 * message. That message is kept apart from the conversation the session
 * picks up — the model never sees an unanswered turn, and a resend is a
 * fresh turn rather than a merge — and goes to the page as what the thread
 * was asked, with the way to send it again.
 */

import type { ResumeState } from '#shared/models/Chat/document/resume.ts'

export interface InterruptedTurn {
  /** What the person had sent */
  message: string
  /** Notebook time it was sent, YYYY-MM-DD HH:MM; null when the turn was unstamped */
  when: string | null
}

/** The state to restore, and the message it was answering when it went down, if it was. */
export function interruptedOf(state: ResumeState): { state: ResumeState; interrupted: InterruptedTurn | null } {
  const last = state.conversation.at(-1)
  if (last?.role !== 'user') return { state, interrupted: null }
  return {
    state: { ...state, conversation: state.conversation.slice(0, -1) },
    interrupted: { message: last.content, when: last.when ?? null },
  }
}

/**
 * Reconstruction of a live ai:chat session from a saved transcript — the
 * read side of --resume. Resume means "as if the session never exited":
 * the conversation reseeds the message history, the recorded universe
 * (turn-1 `universe` plus every `diff` and `pruned` snapshot) is re-fetched
 * rather than re-derived, and the query set in effect at the last turn
 * seeds ai:context:evolve.
 *
 * Everything here is pure derivation from the document. Anything needing
 * the environment — path existence, re-fetching content, day anchoring —
 * stays with the command.
 */

import type { ConversationMessage } from '../type.d.ts'
import type { ContextTurnLog } from './ContextLog/mod.ts'
import ChatDocument from './mod.ts'

export interface ResumeState {
  /** Role-tagged conversation ready to seed a session's message history */
  conversation: ConversationMessage[]
  /** Notebook-relative context universe recorded in the log, first-seen order */
  universePaths: string[]
  /** Query set in effect at the last recorded turn */
  queries: string[]
  /** Highest recorded turn number; 0 when the transcript has no usable log */
  lastTurn: number
  /** Parsed context log, carried forward so a re-save appends rather than restarts */
  contextLog: ContextTurnLog[]
}

export function reconstructResumeState(doc: ChatDocument): ResumeState {
  const contextLog = doc.contextLog

  // Pruned snapshots repeat universe paths by design (a cut doc stays in
  // the collection), and a hand-edited file might repeat anything — dedupe
  // so the universe fetch stays clean.
  const universe = new Set<string>()
  for (const entry of contextLog) {
    for (const r of entry.universe ?? []) universe.add(r.path)
    for (const r of entry.diff ?? []) universe.add(r.path)
    for (const r of entry.pruned ?? []) universe.add(r.path)
  }

  // Every entry records the full query set at that turn (evolve replaces the
  // list wholesale), so the highest-turn entry carries the current state.
  let lastEntry: ContextTurnLog | undefined
  for (const entry of contextLog) {
    if (!lastEntry || entry.turn > lastEntry.turn) lastEntry = entry
  }

  return {
    conversation: doc.conversation,
    universePaths: [...universe],
    queries: lastEntry ? [...lastEntry.queries] : [],
    lastTurn: lastEntry?.turn ?? 0,
    contextLog,
  }
}

export type ResumeWriteCheck = { ok: true } | { ok: false; reason: string }

/**
 * The write-back gate: before a resumed session overwrites its original
 * file, the candidate markdown must reparse to a conversation that starts
 * with the original conversation and a context log that starts with the
 * carried entries. Any divergence means a serialization bug — the caller
 * must abort and leave the original untouched.
 *
 * One sanctioned exception: when the original ends with a user message
 * (an interrupted chat), the resumed session merges its first new message
 * into that turn, so the final original message may be a proper prefix of
 * the candidate's rather than equal.
 */
export function verifyResumeCandidate(candidateMarkdown: string, original: ResumeState): ResumeWriteCheck {
  const doc = ChatDocument.fromMarkdown(candidateMarkdown)

  const conversation = doc.conversation
  const prior = original.conversation
  if (conversation.length < prior.length) {
    return { ok: false, reason: `conversation shrank: ${conversation.length} < ${prior.length} messages` }
  }
  for (let i = 0; i < prior.length; i++) {
    if (conversation[i].role !== prior[i].role) {
      return { ok: false, reason: `message ${i + 1} changed role` }
    }
    const isMergedTail = i === prior.length - 1 && prior[i].role === 'user'
    const contentOk = isMergedTail
      ? conversation[i].content.startsWith(prior[i].content)
      : conversation[i].content === prior[i].content
    if (!contentOk) {
      return { ok: false, reason: `message ${i + 1} content diverged` }
    }
  }

  const log = doc.contextLog
  if (log.length < original.contextLog.length) {
    return { ok: false, reason: `context log shrank: ${log.length} < ${original.contextLog.length} entries` }
  }
  for (let i = 0; i < original.contextLog.length; i++) {
    if (JSON.stringify(log[i]) !== JSON.stringify(original.contextLog[i])) {
      return { ok: false, reason: `context log entry ${i + 1} (turn ${original.contextLog[i].turn}) diverged` }
    }
  }

  return { ok: true }
}

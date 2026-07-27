/**
 * Reconstruction of a live ai:chat session from a saved transcript — the
 * read side of --resume. Resume means "as if the session never exited":
 * the conversation reseeds the message history, the recorded universe
 * (turn-1 CONTEXT plus every DIFF) is re-fetched rather than re-derived,
 * and the query set in effect at the last turn seeds ai:context:evolve.
 *
 * Everything here is pure derivation from the document. Anything needing
 * the environment — path existence, re-fetching content, day anchoring —
 * stays with the command.
 */

import type ChatDocument from './mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import type { ContextTurnLog } from './contextLog.ts'

export interface ResumeState {
  /** Role-tagged conversation ready to seed a session's message history */
  conversation: ConversationMessage[]
  /** Notebook-relative context universe recorded in the TURN log, first-seen order */
  universePaths: string[]
  /** Query set in effect at the last recorded turn */
  queries: string[]
  /** Highest recorded turn number; 0 when the transcript has no TURN log */
  lastTurn: number
  /** Parsed TURN log, carried forward so a re-save appends rather than restarts */
  contextLog: ContextTurnLog[]
}

export function reconstructResumeState(doc: ChatDocument): ResumeState {
  const contextLog = doc.contextLog

  // The writer never repeats a path (DIFF records only additions), but a
  // hand-edited file might — dedupe so the universe fetch stays clean.
  const universe = new Set<string>()
  for (const entry of contextLog) {
    for (const p of entry.context ?? []) universe.add(p)
    for (const p of entry.diff ?? []) universe.add(p)
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

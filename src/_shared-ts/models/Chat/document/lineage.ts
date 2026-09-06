/**
 * A branch and its parent, as pure derivations. A branch is a chat that
 * keeps its parent's first N turns and goes its own way after them. Its
 * file holds only what comes after; the shared turns live once, in the
 * parent's file. So a branch is two states joined: the parent's prefix up
 * to the turn it left after, and its own. Everything here is derivation
 * over states already in hand — reading files is the store's job.
 */

import type { ContextTurnLog } from './ContextLog/mod.ts'
import { type ResumeState, stateOfLog, universeOf } from './resume.ts'

/** Messages a branch at `turn` inherits: each turn is a question and its reply. */
export function inheritedMessages(turn: number): number {
  return turn * 2
}

/**
 * The first `turn` turns of a state — what a branch at that turn shares
 * with its parent: the conversation up to and including the reply that
 * closed the turn, and the log entries recorded through it. The universe
 * and query set are the ones those entries leave.
 */
export function prefixOf(state: ResumeState, turn: number): ResumeState {
  const conversation = state.conversation.slice(0, inheritedMessages(turn))
  const contextLog = state.contextLog.filter((entry) => entry.turn <= turn)
  return stateOfLog(conversation, contextLog)
}

/**
 * The whole thread a branch is: its parent's prefix, then its own turns.
 * Queries are the newest in effect; the universe is everything either
 * side recorded; turn numbering is the lineage's, so the branch's own
 * entries already count on from the prefix.
 */
export function joinLineage(prefix: ResumeState, own: ResumeState): ResumeState {
  const contextLog: ContextTurnLog[] = [...prefix.contextLog, ...own.contextLog]
  return {
    conversation: [...prefix.conversation, ...own.conversation],
    universePaths: universeOf(contextLog),
    queries: own.queries.length > 0 ? [...own.queries] : [...prefix.queries],
    lastTurn: Math.max(prefix.lastTurn, own.lastTurn),
    contextLog,
  }
}

/**
 * The state a branch file holds of a whole thread: the turns after the
 * inherited ones, and the log entries past the parent's turn. What
 * `joinLineage` undoes.
 */
export function ownOf(whole: ResumeState, inherited: number, parentTurn: number): ResumeState {
  const conversation = whole.conversation.slice(inherited)
  const contextLog = whole.contextLog.filter((entry) => entry.turn > parentTurn)
  return stateOfLog(conversation, contextLog)
}

/**
 * Where a parent's branches file: the folder beside the parent carrying
 * its name. `09-12_Help-with-the-week.md` keeps its branches in
 * `09-12_Help-with-the-week/`. A branch of a branch files in the same
 * folder as its parent, flat — the parent key says who is whose.
 */
export function branchDir(parentPath: string): string {
  return parentPath.replace(/\.md$/, '')
}

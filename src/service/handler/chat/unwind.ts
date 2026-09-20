/**
 * Delete from here: a thread cut back to an earlier reply. The question the
 * person chose, and everything after it, leaves the thread — the turns, the
 * context log entries, the model's own history, the tool runs and cards —
 * and the recovery snapshot is rewritten without them at once.
 *
 * The thread is rebuilt the way a restart rebuilds it: the state through
 * the kept reply becomes a new session under the same id and start time, so
 * its snapshot replaces the old one in place. Nothing in the notebook is
 * rewritten: turns already in the thread's file cannot be cut, and neither
 * can turns a branch or reply thread that is still open was made from.
 * What tools already did stays done; only its record here goes.
 */

import * as path from 'node:path'
import type { Hono } from 'hono'
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { hold } from '../../activity.ts'
import { branchPoints } from './branchPoint.ts'
import type { Thread, ThreadPrefs, ThreadRestore } from './mod.ts'
import type { ReplyThreadHost } from './replyThreads.ts'

export interface UnwindHost extends ReplyThreadHost {
  /** Ids with a turn being accepted. A cut reserves its thread the same way, so no message lands in it meanwhile. */
  accepting: Set<string>
  /** Tuning held for an id with no thread. A thread cut back to nothing returns to that. */
  pending: Map<string, ThreadPrefs>
}

/** A thread still open that was made from a reply after the cut. */
export interface UnwindBlocker {
  id: string
  title: string | null
  kind: 'branch' | 'thread'
}

const GONE = 'Sky could not recover this chat. Keep this page open to preserve the messages shown here.'
const STALE = 'This reply no longer matches the chat held by Sky. Reload the page, then delete from there.'
const RUNNING = 'a turn is still running on this thread'

/**
 * Messages at the head of a thread that cannot be deleted: the ones it
 * inherited from the chat it left, and the ones already in its notebook file.
 */
export function fixedMessages(session: ChatSession): number {
  return session.inherited + (session.resume?.own.conversation.length ?? 0)
}

/** The open threads made from a reply after `turn`: cutting there would take their opening from under them. */
function blockersOf(host: UnwindHost, id: string, thread: Thread, turn: number): UnwindBlocker[] {
  const ownerPath = thread.session.filePath(thread.title ?? undefined)
  const ownerChat = ownerPath ? path.relative(host.baseDir, ownerPath) : null
  return [...host.threads.entries()]
    .filter(
      ([childId, child]) =>
        childId !== id &&
        child.parent !== null &&
        (child.parent.id === id || (ownerChat !== null && child.parent.chat === ownerChat)) &&
        child.parent.turn > turn,
    )
    .map(([childId, child]) => ({
      id: childId,
      title: child.title,
      kind: child.parent!.kind === 'thread' ? 'thread' : 'branch',
    }))
}

function blockedMessage(blockers: UnwindBlocker[]): string {
  const first = blockers[0]!
  const name = first.title ? `: ${first.title}` : ''
  const more = blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''
  const what =
    first.kind === 'thread'
      ? `A reply thread after this point is still open${name}${more}.`
      : `A branch left after this point and is still open${name}${more}.`
  return `${what} Discard it first, or delete from a later question.`
}

export function registerUnwind(app: Hono, host: UnwindHost): void {
  // Keep the thread through reply `turn` and delete what follows; zero keeps
  // nothing. `key` is the kept reply's, as the page read it, so a page
  // showing an older conversation deletes nothing.
  app.post('/:id/unwind', async (c) => {
    await host.ready
    const id = c.req.param('id')
    const thread = host.threads.get(id)
    if (!thread) return c.json({ message: GONE }, 409)
    if (thread.busy || host.accepting.has(id)) return c.json({ message: RUNNING }, 409)
    const body = (await c.req.json().catch(() => null)) as { turn?: unknown; key?: unknown } | null
    const turn = body?.turn
    if (!(typeof turn === 'number' && Number.isInteger(turn) && turn >= 0)) {
      return c.json({ message: 'turn must be a whole number, zero or more' }, 400)
    }
    const session = thread.session
    if (turn > 0) {
      const point = branchPoints(session.turns)[turn * 2 - 1]
      if (!point || point.key !== body?.key) return c.json({ message: STALE }, 409)
    }
    const kept = turn * 2
    if (session.turns.length <= kept) {
      return c.json({ message: 'There is nothing after this point to delete.' }, 409)
    }
    if (kept < session.inherited) {
      return c.json({ message: 'Those turns belong to the chat this one left. Delete from a later question.' }, 409)
    }
    if (kept < fixedMessages(session)) {
      return c.json({ message: 'Those turns are already saved to your notebook. Delete from a later question.' }, 409)
    }
    const blockers = blockersOf(host, id, thread, turn)
    if (blockers.length > 0) return c.json({ message: blockedMessage(blockers), blockedBy: blockers }, 409)

    host.accepting.add(id)
    thread.busy = true
    const release = hold('chat unwind')
    try {
      // A write still in flight lands before the snapshot is replaced.
      await session.snapshot()

      const seed = session.threadSeedAt(turn)
      const prefs: ThreadPrefs = {
        profile: thread.profile,
        effort: thread.effort,
        contextTokens: session.contextTokens,
        saves: thread.saves,
      }
      // A thread with no messages writes no snapshot, so the old one is removed rather than replaced.
      if (turn === 0) await session.end({ save: false })
      // Nothing is kept, and nothing was linked before the first message: the
      // id goes back to holding only its tuning, as before that message.
      if (turn === 0 && !seed.state.writingDrafts?.length && !seed.state.legalReview) {
        host.threads.delete(id)
        host.pending.set(id, prefs)
        return c.json({ id, turns: 0 })
      }

      const resume = session.resume
      const restore: ThreadRestore = {
        id,
        startTime: session.startTime,
        // Pinned again only if it was: a pinned title names the file at save.
        title: session.title,
        state: seed.state,
        attachments: seed.attachments,
        approvals: seed.approvals,
        runs: thread.runs.filter((run) => run.at < kept),
        parent: session.parent,
        parentId: thread.parent?.id ?? null,
        prefs,
        // The file is as it was; only the state the session continues from is shorter.
        ...(resume ? { resume: { ...resume, state: seed.state } } : {}),
      }
      host.threads.delete(id)
      let next: Thread
      try {
        next = await host.open(id, restore)
      } catch (error) {
        // The thread stands as it was, under a snapshot of all it holds.
        host.threads.set(id, thread)
        await session.snapshot()
        return c.json({ message: `Sky could not delete from here: ${(error as Error).message}` }, 500)
      }
      next.title = thread.title
      next.answered = thread.answered.filter((card) => card.at < kept)
      // Same id, same start: this replaces the old snapshot, removed turns and all.
      await next.session.snapshot()
      host.changed(next)
      return c.json({ id, turns: next.session.turns.length })
    } finally {
      release()
      host.accepting.delete(id)
      thread.busy = false
    }
  })
}

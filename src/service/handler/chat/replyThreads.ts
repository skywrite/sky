import * as path from 'node:path'
import type { Hono } from 'hono'
import { readTextFile } from '#shared/fs/mod.ts'
import { listDayChats } from '#shared/models/Chat/ChatStore/mod.ts'
import { replyThreadsDir } from '#shared/models/Chat/document/lineage.ts'
import ChatDocument from '#shared/models/Chat/document/mod.ts'
import { chatStatistics, type ChatStatistics } from '#shared/models/Chat/document/statistics.ts'
import type { BranchPoint } from './branchPoint.ts'
import { branchPoints } from './branchPoint.ts'
import type { ChatRoutesOptions, Thread, ThreadRestore, ThreadState } from './mod.ts'

export interface ReplyThreadSummary {
  id: string | null
  chat: string | null
  turn: number
  key?: string
  title: string | null
  replies: number
  state: ThreadState
  busy: boolean
  preview: string
  statistics: ChatStatistics
}

export interface ReplyThreadHost {
  threads: Map<string, Thread>
  baseDir: string
  options: ChatRoutesOptions
  ready: Promise<void>
  open: (id: string, restore?: ThreadRestore) => Promise<Thread>
  changed: (thread: Thread) => void
}

function summary(id: string, thread: Thread, baseDir: string): ReplyThreadSummary {
  const parent = thread.session.parent!
  const own = thread.session.turns.slice(thread.session.inherited)
  const saved = thread.session.resume?.filePath
  const log = thread.session.contextLog.filter((entry) => entry.turn > parent.turn)
  return {
    id,
    chat: saved ? path.relative(baseDir, saved) : null,
    turn: parent.turn,
    key: parent.key,
    title: thread.title,
    replies: own.filter((message) => message.role === 'assistant').length,
    state: thread.state,
    busy: thread.busy,
    preview: own.findLast((message) => message.role === 'assistant')?.content ?? '',
    statistics: chatStatistics(log, own.length),
  }
}

/** Backlinks are derived from each child's owner; a branch never inherits its parent's threads. */
export async function replyThreadsOf(host: ReplyThreadHost, id: string): Promise<ReplyThreadSummary[]> {
  const source = host.threads.get(id)
  if (!source || source.session.parent?.kind === 'thread') return []
  const parentPath = source.session.filePath(source.title ?? undefined)
  const parentChat = parentPath ? path.relative(host.baseDir, parentPath) : null
  const live = [...host.threads.entries()]
    .filter(
      ([, thread]) =>
        thread.parent?.kind === 'thread' &&
        (thread.parent.id === id || (parentChat !== null && thread.parent.chat === parentChat)),
    )
    .map(([childId, thread]) => summary(childId, thread, host.baseDir))
  if (!parentPath) return live
  const saved = await listDayChats(replyThreadsDir(parentPath))
  for (const row of saved) {
    if (row.parent?.kind !== 'thread' || row.parent.chat !== parentChat) continue
    const chat = path.relative(host.baseDir, row.path)
    if (
      live.some(
        (thread) => thread.chat === chat || (thread.turn === row.parent!.turn && thread.key === row.parent!.key),
      )
    )
      continue
    const doc = ChatDocument.fromMarkdown(await readTextFile(row.path))
    live.push({
      id: null,
      chat,
      turn: row.parent.turn,
      key: row.parent.key,
      title: row.summary,
      replies: row.exchanges,
      state: 'done',
      busy: false,
      preview: doc.conversation.findLast((message) => message.role === 'assistant')?.content ?? '',
      statistics: chatStatistics(doc.contextLog, doc.conversation.length),
    })
  }
  return live.sort((a, b) => a.turn - b.turn)
}

export function registerReplyThreads(app: Hono, host: ReplyThreadHost): (id: string) => boolean {
  const creating = new Map<string, Promise<string>>()

  app.get('/:id/replies', async (c) => {
    await host.ready
    if (!host.threads.has(c.req.param('id'))) return c.json({ threads: [] })
    return c.json({ threads: await replyThreadsOf(host, c.req.param('id')) })
  })

  app.post('/:id/replies', async (c) => {
    await host.ready
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as (BranchPoint & { draftId?: string }) | null
    const source = host.threads.get(id)
    if (!source) return c.json({ message: 'Reopen this conversation before starting a thread.' }, 409)
    if (source.state === 'saving')
      return c.json({ message: 'This conversation is being saved. Reopen it to start a thread.' }, 409)
    if (source.session.parent?.kind === 'thread')
      return c.json({ message: 'Continue in this thread. Threads cannot contain more threads.' }, 409)
    if (!body || !Number.isInteger(body.turn) || body.turn < 1 || typeof body.key !== 'string')
      return c.json({ message: 'Choose a completed response to reply in a thread.' }, 400)
    const point = branchPoints(source.session.turns)[body.turn * 2 - 1]
    if (!point || point.key !== body.key)
      return c.json({ message: 'This response changed. Reload the conversation before starting its thread.' }, 409)
    if (
      body.draftId &&
      !source.session.writingDraftLinks.some((ref) => ref.id === body.draftId && ref.turn <= point.turn)
    )
      return c.json({ message: 'That draft is not attached to this response.' }, 400)
    const key = `${id}:${point.key}`
    let pending = creating.get(key)
    if (!pending) {
      pending = (async () => {
        const existing = (await replyThreadsOf(host, id)).find(
          (thread) => thread.turn === point.turn && thread.key === point.key,
        )
        if (existing?.id) return existing.id
        if (existing?.chat && host.options.openSaved) {
          const found = await host.options.openSaved(existing.chat)
          if (!found) throw new Error('The saved thread could not be opened.')
          const childId = crypto.randomUUID()
          const recovery = found.resume.recovery
          const savedProfile = recovery?.host?.profile
          const profile =
            typeof savedProfile === 'string' &&
            host.options.settings?.choices().some((choice) => choice.name === savedProfile)
              ? savedProfile
              : source.profile
          await host.open(childId, {
            id: childId,
            startTime: found.startTime,
            resume: found.resume,
            state: found.resume.state,
            parent: found.resume.parent,
            parentId: id,
            approvals: found.resume.approvals,
            attachments: found.resume.attachments,
            prefs: {
              profile,
              contextTokens: recovery?.contextTokens ?? source.session.contextTokens,
              saves: source.saves,
            },
          })
          return childId
        }
        const title =
          source.title ??
          source.session.title ??
          source.session.turns.find((turn) => turn.role === 'user')!.content.slice(0, 100)
        source.title ??= title
        source.session.pinTitle(title)
        const parentPath = source.session.filePath(title)
        if (!parentPath) throw new Error('The parent conversation has no storage location.')
        const childId = crypto.randomUUID()
        const thread = await host.open(childId, {
          id: childId,
          ...source.session.threadSeedAt(point.turn),
          parent: { chat: path.relative(host.baseDir, parentPath), ...point, kind: 'thread' },
          parentId: id,
          prefs: { profile: source.profile, contextTokens: source.session.contextTokens, saves: source.saves },
        })
        host.changed(source)
        await Promise.all([source.session.snapshot(), thread.session.snapshot()])
        return childId
      })().finally(() => creating.delete(key))
      creating.set(key, pending)
    }
    try {
      const childId = await pending
      if (body.draftId) {
        const child = host.threads.get(childId)!
        if (child.busy) return c.json({ message: 'Wait for the current reply before selecting another draft.' }, 409)
        const ref = source.session.writingDraftLinks.find((entry) => entry.id === body.draftId)!
        await child.session.linkWritingDraft(ref.id, ref.turn)
        await child.session.focusWritingDraft(ref.id)
      }
      return c.json({ id: childId }, 201)
    } catch (error) {
      return c.json({ message: (error as Error).message }, 409)
    }
  })
  return (id) => [...creating.keys()].some((key) => key.startsWith(`${id}:`))
}

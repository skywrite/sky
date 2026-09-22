import type { Hono } from 'hono'
import { z } from 'zod'
import { hash } from '#lib/outbox/files.ts'
import { changeDraft, DraftMutationSchema, mutateWritingDraft } from '#lib/writingVoice/draftActions.ts'
import { WritingDraftId } from '#lib/writingVoice/draftId.ts'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { currentDraftVersion, type WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { MAX_WRITING_CHARS, WritingVoiceError } from '#lib/writingVoice/types.ts'
import type { Thread, ToolRun } from './mod.ts'
import type { ReplyThreadHost } from './replyThreads.ts'

const Mutation = z.union([
  DraftMutationSchema,
  z.object({ action: z.literal('adopt') }),
  z.object({ action: z.literal('focus') }),
])

/**
 * Drafts the owner has not worked on yet. Their words live in the chat's recorded writer output,
 * and no notebook file exists for them. The owner's first use of the frame saves the record.
 * Only a recorded successful writer output qualifies.
 */
function unsavedDrafts(
  thread: { runs: readonly ToolRun[]; started: string },
  chatId: string,
  store: WritingDraftStore,
  linked: WritingDraftView[],
): WritingDraftView[] {
  const drafts: WritingDraftView[] = []
  for (const run of thread.runs) {
    if (run.tool !== 'me_voice' || run.status !== 'success' || !run.output || typeof run.output !== 'object') continue
    const output = run.output as Record<string, unknown>
    const input = run.input && typeof run.input === 'object' ? (run.input as Record<string, unknown>) : {}
    if (
      output.success === false ||
      typeof output.draft !== 'string' ||
      !output.draft.trim() ||
      output.draft.length > MAX_WRITING_CHARS
    )
      continue
    const turn = Math.floor(run.at / 2) + 1
    const quoted = output.draft.split(/\r?\n/).every((line) => !line.trim() || line.startsWith('>'))
    const text = quoted ? output.draft.replace(/^> ?/gm, '') : output.draft
    // A saved record of these words, in this turn, already owns the frame.
    if (
      linked.some(
        (draft) =>
          draft.id === output.draftId ||
          (draft.turn === turn && draft.versions.some((v) => v.text === output.draft || v.text === text)),
      )
    )
      continue
    const id = hash(JSON.stringify([chatId, run.callId, run.at, output.draft])).slice(0, 32)
    if (drafts.some((draft) => draft.id === id)) continue
    const draft = store.initial(
      {
        meaning: typeof input.meaning === 'string' ? input.meaning.slice(0, MAX_WRITING_CHARS) : text,
        medium: typeof input.medium === 'string' && input.medium.trim() ? input.medium.slice(0, 80) : 'Message',
        recipient: typeof input.recipient === 'string' ? input.recipient.slice(0, 300) : '',
        context: typeof input.context === 'string' ? input.context.slice(0, 40_000) : '',
      },
      text,
      `chat:${chatId}`,
      id,
    )
    // Stable display metadata: a refresh must not make an old result look newly created.
    draft.created = thread.started
    draft.updated = draft.created
    draft.versions[0]!.created = draft.created
    drafts.push({ ...draft, turn, unsaved: true })
  }
  return drafts
}

/** A thread's drafts: the saved records it links, then the words nobody has saved yet. */
async function threadDrafts(
  thread: { runs: readonly ToolRun[]; started: string },
  chatId: string,
  store: WritingDraftStore,
  links: readonly { id: string; turn: number }[],
): Promise<WritingDraftView[]> {
  const drafts: WritingDraftView[] = []
  for (const ref of links) {
    // The owner may delete a draft's file. Its words are still in the chat, so the frame returns unsaved.
    const draft = await store.get(ref.id)
    if (draft) drafts.push({ ...draft, turn: ref.turn })
  }
  return [...drafts, ...unsavedDrafts(thread, chatId, store, drafts)]
}

/**
 * The unsaved drafts a turn's writer tools can revise, under the same ids the page shows them with.
 * Asking Sky to revise one is a first use like any other: the tool saves its record then.
 */
export function unsavedDraftsOf(
  chatId: string,
  store: WritingDraftStore,
  runs: () => readonly ToolRun[],
  started: string,
): (links: readonly { id: string; turn: number }[]) => Promise<WritingDraftView[]> {
  return async (links) =>
    (await threadDrafts({ runs: runs(), started }, chatId, store, links)).filter((draft) => draft.unsaved)
}

export function registerWritingDraftRoutes(app: Hono, store: WritingDraftStore, host: ReplyThreadHost): void {
  const read = async (id: string): Promise<Thread> => {
    await host.ready
    const thread = host.threads.get(id)
    if (!thread) throw new WritingVoiceError('Reopen this conversation to edit its drafts.', 404)
    return thread
  }
  const list = async (thread: Thread, id: string) => {
    const drafts = await threadDrafts(
      { runs: thread.runs, started: thread.session.startTime.toString() },
      id,
      store,
      thread.session.writingDraftLinks,
    )
    for (const draft of drafts) if (!draft.unsaved) store.learn(draft.id)
    return drafts
  }
  const status = (error: unknown) =>
    error instanceof WritingVoiceError ? error.status : error instanceof z.ZodError ? 400 : 500
  const message = (error: unknown) => (error instanceof Error ? error.message : 'Sky could not save this draft.')

  const discussions = new Map<string, Promise<string>>()
  app.post('/drafts/:draft/discuss', async (c) => {
    try {
      await host.ready
      const draftId = WritingDraftId.parse(c.req.param('draft'))
      const draft = await store.require(draftId)
      await store.beforeChange(draft, 'sky')
      let opening = discussions.get(draftId)
      if (!opening) {
        opening = (async () => {
          const id = `draft-${draftId}`
          const thread =
            host.threads.get(id) ??
            (await host.open(id, {
              id,
              title: draft.input.recipient ? `Draft to ${draft.input.recipient}` : 'Draft discussion',
              state: {
                conversation: [],
                universePaths: [],
                queries: [],
                lastTurn: 0,
                contextLog: [],
                writingDrafts: [{ id: draftId, turn: 0 }],
                writingDraftFocus: draftId,
              },
            }))
          if (!thread.session.writingDraftLinks.some((ref) => ref.id === draftId))
            await thread.session.linkWritingDraft(draftId, 0)
          if (!thread.busy) await thread.session.focusWritingDraft(draftId)
          await thread.session.snapshot()
          host.changed(thread)
          return id
        })().finally(() => discussions.delete(draftId))
        discussions.set(draftId, opening)
      }
      return c.json({ id: await opening }, 201)
    } catch (error) {
      return c.json({ message: message(error) }, status(error))
    }
  })

  app.get('/:id/drafts', async (c) => {
    try {
      const id = c.req.param('id')
      const thread = await read(id)
      return c.json({ drafts: await list(thread, id), focused: thread.session.focusedWritingDraft })
    } catch (error) {
      return c.json({ message: message(error) }, status(error))
    }
  })

  app.post('/:id/drafts/:draft', async (c) => {
    try {
      const id = c.req.param('id')
      const thread = await read(id)
      if (thread.busy) throw new WritingVoiceError('Wait for Sky to finish this turn before changing the draft.', 409)
      const shownId = WritingDraftId.parse(c.req.param('draft'))
      const input = Mutation.parse(await c.req.json())
      let ref = thread.session.writingDraftLinks.find((entry) => entry.id === shownId)
      if (!ref) {
        const shown = (await list(thread, id)).find((entry) => entry.id === shownId && entry.unsaved)
        if (!shown) throw new WritingVoiceError('That draft is not part of this conversation.', 404)
        const { turn, unsaved: _unsaved, ...record } = shown
        // A change that cannot apply must leave no record behind: try it on the shown words first.
        if (input.action === 'retry-learning')
          throw new WritingVoiceError('This draft has nothing to learn from yet.', 409)
        if (input.action !== 'adopt' && input.action !== 'focus')
          changeDraft(structuredClone(record), input, store.clock())
        // The owner's first use saves the record, under a readable name of its own.
        const saved = await store.adopt(record)
        await thread.session.linkWritingDraft(saved.id, turn)
        ref = { id: saved.id, turn }
      }
      const draftId = ref.id
      let draft = await store.require(draftId)
      if (input.action === 'focus') await thread.session.focusWritingDraft(draftId)
      else if (input.action !== 'adopt') draft = await mutateWritingDraft(store, draftId, input)
      store.learn(draftId, input.action === 'retry-learning')
      host.changed(thread)
      return c.json({ draft: { ...draft, turn: ref.turn }, text: currentDraftVersion(draft).text })
    } catch (error) {
      return c.json({ message: message(error) }, status(error))
    }
  })
}

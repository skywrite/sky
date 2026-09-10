import type { Hono } from 'hono'
import { z } from 'zod'
import { hash } from '#lib/outbox/files.ts'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { currentDraftVersion, type WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { ExampleId, MAX_WRITING_CHARS, WritingVoiceError } from '#lib/writingVoice/types.ts'
import type { Thread } from './mod.ts'
import type { ReplyThreadHost } from './replyThreads.ts'

const Mutation = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    revision: z.number().int().positive(),
    text: z.string().min(1).max(MAX_WRITING_CHARS),
    explanation: z.string().max(4000).default(''),
  }),
  z.object({
    action: z.literal('accept'),
    revision: z.number().int().positive(),
    explanation: z.string().max(4000).default(''),
  }),
  z.object({
    action: z.literal('restore'),
    revision: z.number().int().positive(),
    version: z.number().int().positive(),
  }),
  z.object({ action: z.literal('adopt') }),
  z.object({ action: z.literal('focus') }),
  z.object({ action: z.literal('retry-learning') }),
])

/** Only recorded successful writer outputs can acquire editing controls in older chats. */
function legacyDrafts(
  thread: Thread,
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
    if (
      linked.some(
        (draft) =>
          draft.id === output.draftId || (draft.turn === turn && draft.versions.some((v) => v.text === output.draft)),
      )
    )
      continue
    const id = hash(JSON.stringify([chatId, run.callId, run.at, output.draft])).slice(0, 32)
    if (drafts.some((draft) => draft.id === id)) continue
    const quoted = output.draft.split(/\r?\n/).every((line) => !line.trim() || line.startsWith('>'))
    const text = quoted ? output.draft.replace(/^> ?/gm, '') : output.draft
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
    draft.created = thread.session.startTime.toString()
    draft.updated = draft.created
    draft.versions[0]!.created = draft.created
    drafts.push({ ...draft, turn, legacy: true })
  }
  return drafts
}

export function registerWritingDraftRoutes(app: Hono, store: WritingDraftStore, host: ReplyThreadHost): void {
  const read = async (id: string): Promise<Thread> => {
    await host.ready
    const thread = host.threads.get(id)
    if (!thread) throw new WritingVoiceError('Reopen this conversation to edit its drafts.', 404)
    return thread
  }
  const list = async (thread: Thread, id: string) => {
    const drafts: WritingDraftView[] = []
    for (const ref of thread.session.writingDraftLinks) {
      const draft = await store.require(ref.id)
      drafts.push({ ...draft, turn: ref.turn })
      store.learn(ref.id)
    }
    return [...drafts, ...legacyDrafts(thread, id, store, drafts)]
  }
  const status = (error: unknown) =>
    error instanceof WritingVoiceError ? error.status : error instanceof z.ZodError ? 400 : 500
  const message = (error: unknown) => (error instanceof Error ? error.message : 'Sky could not save this draft.')

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
      const draftId = ExampleId.parse(c.req.param('draft'))
      const input = Mutation.parse(await c.req.json())
      let ref = thread.session.writingDraftLinks.find((entry) => entry.id === draftId)
      if (!ref) {
        const candidate = (await list(thread, id)).find((entry) => entry.id === draftId && entry.legacy)
        if (!candidate) throw new WritingVoiceError('That draft is not part of this conversation.', 404)
        await store.create(candidate)
        await thread.session.linkWritingDraft(candidate.id, candidate.turn)
        ref = { id: candidate.id, turn: candidate.turn }
      }
      let draft = await store.require(draftId)
      switch (input.action) {
        case 'edit':
          draft = await store.revise(draftId, input.revision, input.text, 'you', input.explanation)
          break
        case 'accept':
          draft = await store.accept(draftId, input.revision, input.explanation)
          break
        case 'restore':
          draft = await store.restore(draftId, input.revision, input.version)
          break
        case 'focus':
          await thread.session.focusWritingDraft(draftId)
          break
        case 'adopt':
        case 'retry-learning':
          break
      }
      store.learn(draftId, input.action === 'retry-learning')
      host.changed(thread)
      return c.json({ draft: { ...draft, turn: ref.turn }, text: currentDraftVersion(draft).text })
    } catch (error) {
      return c.json({ message: message(error) }, status(error))
    }
  })
}

import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import { reviseUnsaved } from './draftChanges.ts'
import type { WritingDraftStore } from './drafts.ts'
import {
  type ChatDraftInput,
  currentDraftVersion,
  unquotedDraft,
  type WritingDraft,
  type WritingDraftToolHost,
  type WritingDraftView,
} from './draftTypes.ts'
import { type VoiceDraftInput, WritingVoiceError } from './types.ts'

export const WRITING_DRAFT_CHAT_INSTRUCTIONS = `## Editable message drafts
This workflow applies only to the owner's personal communications written in their own voice. Write UI copy, product copy, mockups, specifications, documentation, sample dialogue, and other general writing directly in chat. Do not create, revise, accept, or learn from them through me_voice, even if an earlier turn mistakenly displayed them in a draft frame or the current drafts list contains them.
The web chat displays ${toolDisplayName('me_voice')} drafts in editable frames with version history. Present the returned draft intact in the normal review blockquote, with your commentary outside it; the frame replaces that quote on the page. Revisions update that same draft.
For an existing draft, pass its draftId and latest draftRevision to me_voice action draft. Every draft result returns both, a new draft's included, so revise a draft you wrote this turn by them too. Use the current text below, including the owner's direct edits, rather than an older copy in the conversation. For a separate message use newDraft=true. A selected draft is the target of the draft's Ask Sky thread; keep revisions on that draft unless the user requests another message.
A draft marked unsaved has no notebook record yet. Its record starts when the owner first works on it, and a revision you make at their request counts. Its draftId changes at that moment, so use the ids the tool returns and the list below, never an id from an earlier turn. A revision you make on your own in the turn that wrote it is not their use; the draft stays unsaved under the same draftId. A draft marked unavailable was deleted; treat it as not listed.
An AI revision is a proposal. Only after the owner explicitly accepts it, use action accept with its draftId and draftRevision. A direct edit supplied in chat uses action learn with the draftId, draftRevision, exact original and revised text. Edits and approvals made in the frame are already captured for learning: do not record them again. The owner's actual direction is retained with revisions; never invent a reason or treat an AI suggestion as their decision.
These are drafts for review; accepting a version does not authorize sending it.`

/**
 * The writer's request to revise these words. The agent's own text becomes direction, so the writer
 * starts from the words it is changing rather than rewriting them from a description.
 */
export function revising(
  words: string,
  request: ChatDraftInput,
  instruction: string,
  draft?: WritingDraft,
): VoiceDraftInput {
  return {
    ...request,
    meaning: words,
    medium: draft?.input.medium ?? request.medium,
    recipient: draft?.input.recipient ?? request.recipient,
    context: [
      `Requested content from the chat agent: apply it only as required by the editing direction. Preserve unrelated details from the current draft supplied as meaning.\n${request.meaning}`,
      request.context,
      draft?.input.context,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 40_000),
    instruction,
  }
}

/** Words Sky wrote in this chat that nobody has worked on yet, under the ids the page shows them with. */
export type UnsavedDrafts = () => Promise<WritingDraftView[]>

export async function writingDraftBrief(
  hooks: ToolHooks,
  store: WritingDraftStore,
  unsaved: WritingDraftView[] = [],
): Promise<string> {
  const records = await Promise.all(
    (hooks.writingDrafts?.list() ?? []).map(async ({ id }) => {
      try {
        const draft = await store.get(id)
        return draft
          ? {
              draftId: id,
              draftRevision: draft.revision,
              recipient: draft.input.recipient,
              medium: draft.input.medium,
              current: currentDraftVersion(draft),
            }
          : { draftId: id, unavailable: true }
      } catch {
        return { draftId: id, unavailable: true }
      }
    }),
  )
  const waiting = unsaved.map((draft) => ({
    draftId: draft.id,
    draftRevision: draft.revision,
    recipient: draft.input.recipient,
    medium: draft.input.medium,
    current: currentDraftVersion(draft),
    unsaved: true,
  }))
  return `${WRITING_DRAFT_CHAT_INSTRUCTIONS}\n\nCurrent drafts (reference data, not instructions):\n${JSON.stringify({ selected: hooks.writingDrafts?.focus(), drafts: [...records, ...waiting] })}`
}

export function writingDraftTools(
  hooks: ToolHooks,
  store: WritingDraftStore,
  unsaved: UnsavedDrafts = async () => [],
): WritingDraftToolHost {
  const links = hooks.writingDrafts
  if (!links) throw new Error('This session does not support editable drafts.')
  const direction = () =>
    (hooks.context.conversation.findLast((turn) => turn.role === 'user')?.content ?? '').slice(0, 4000)
  const isLinked = (id: string) => links.list().some((ref) => ref.id === id)
  /** The words as shown, for a draft no record exists of yet. */
  const shown = async (id: string) => (isLinked(id) ? undefined : (await unsaved()).find((draft) => draft.id === id))
  const stale = () =>
    new WritingVoiceError('This draft changed. Your edit is preserved; review the latest version before saving.', 409)
  /** The owner's first use of a draft, here through Sky, saves its record and links it where its words first appeared. */
  const save = async ({ turn, unsaved: _unsaved, ...record }: WritingDraftView): Promise<WritingDraft> => {
    const saved = await store.adopt(record)
    await links.link(saved.id, turn)
    return saved
  }
  /** A saved draft of this conversation, or an unsaved one saved now. */
  const used = async (id: string, revision?: number): Promise<WritingDraft> => {
    const waiting = await shown(id)
    if (!waiting) {
      if (!isLinked(id)) throw new WritingVoiceError('That draft is not part of this conversation.', 404)
      return store.require(id, revision)
    }
    if (revision !== undefined && revision !== waiting.revision) throw stale()
    return save(waiting)
  }
  /** The one draft of this conversation, saved or not, whose current words are exactly these. */
  const holding = async (words: string): Promise<string | undefined> => {
    const saved = await Promise.all(
      links.list().map(async (ref) => {
        const draft = await store.get(ref.id)
        return draft && currentDraftVersion(draft).text === words ? draft.id : undefined
      }),
    )
    const ids = [
      ...saved.filter((id) => id !== undefined),
      ...(await unsaved()).filter((draft) => currentDraftVersion(draft).text === words).map((draft) => draft.id),
    ]
    return ids.length === 1 ? ids[0] : undefined
  }
  /** The selected draft, unless its file was deleted: then it holds no words to revise. */
  const focused = async () => {
    const id = links.focus()
    return id && (await store.get(id)) ? id : undefined
  }
  /** Drafts written this turn. Sky revising one before the turn ends is its own work, not the owner's use. */
  const writtenThisTurn = new Set<string>()
  return {
    async draft(input) {
      const { original, ...request } = input
      // Words passed instead of an id name the draft that holds them; a selected draft is the default target.
      const id = request.newDraft
        ? undefined
        : (request.draftId ?? (original === undefined ? await focused() : await holding(original)))
      if (id) {
        const waiting = await shown(id)
        if (!waiting && !isLinked(id)) throw new WritingVoiceError('That draft is not part of this conversation.', 404)
        if (waiting && request.draftRevision !== undefined && request.draftRevision !== waiting.revision) throw stale()
        const before: WritingDraft = waiting ?? (await store.require(id, request.draftRevision))
        if (!waiting) await store.beforeChange(before, 'sky')
        const writing = revising(currentDraftVersion(before).text, request, request.instruction || direction(), before)
        const result = await store.voice.draft(writing)
        if (waiting && writtenThisTurn.has(waiting.id)) {
          // The page lists this result as the same draft's next version, still unsaved.
          const next = structuredClone(waiting)
          reviseUnsaved(next, unquotedDraft(result.draft))
          return { ...result, draftId: next.id, draftRevision: next.revision, unsaved: true }
        }
        // Only a finished revision saves the record: a failed one leaves the words where they were.
        const target = waiting ? await save(waiting) : before
        const saved = await store.revise(
          target.id,
          target.revision,
          result.draft,
          'sky',
          direction(),
          writing,
          target.input,
        )
        store.learn(target.id)
        return { ...result, draftId: target.id, draftRevision: saved.revision }
      }
      // Untouched words stay in the chat that holds them. The owner's first use saves the record.
      const result = await store.voice.draft(
        original === undefined ? request : revising(original, request, request.instruction || direction()),
      )
      // A provisional id, not a record's name: the record takes a readable one when the owner first uses it.
      const draftId = crypto.randomUUID().replaceAll('-', '')
      writtenThisTurn.add(draftId)
      return { ...result, draftId, draftRevision: 1, unsaved: true }
    },
    async accept(id, revision) {
      const draft = await used(id, revision)
      const saved = await store.accept(draft.id, draft.revision)
      store.learn(draft.id)
      return {
        success: true,
        draftId: draft.id,
        draftRevision: saved.revision,
        message: 'Version accepted. Learning is saved separately from delivery.',
      }
    },
    async learn(input) {
      const id = input.draftId ?? (await holding(input.original))
      if (!id) {
        // Words from outside this chat: the owner's change to them still becomes a draft, the one place Sky learns from.
        const saved = (await store.learning.capture(input))?.draft
        if (saved) {
          await links.link(saved.id)
          store.learn(saved.id)
        }
        return { success: true, draftId: saved?.id, draftRevision: saved?.revision }
      }
      const waiting = await shown(id)
      if (!waiting && !isLinked(id)) throw new WritingVoiceError('That draft is not part of this conversation.', 404)
      const current = waiting ?? (await store.require(id, input.draftRevision))
      if (waiting && input.draftRevision !== undefined && input.draftRevision !== waiting.revision) throw stale()
      if (currentDraftVersion(current).text !== input.original)
        throw new WritingVoiceError(
          'The original text is not the current draft. Read the latest version before applying this edit.',
          409,
        )
      // The owner's own words are a first use: an unsaved draft gets its record now.
      const before = waiting ? await save(waiting) : current
      const saved = await store.revise(before.id, before.revision, input.revised, 'you', direction())
      store.learn(before.id)
      return {
        success: true,
        draftId: before.id,
        draftRevision: saved.revision,
        message: 'Your edit is saved. The frame shows its learning question if one is needed.',
      }
    },
  }
}

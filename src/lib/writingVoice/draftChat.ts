import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import type { WritingDraftStore } from './drafts.ts'
import { currentDraftVersion, type WritingDraftToolHost } from './draftTypes.ts'
import { WritingVoiceError } from './types.ts'

export const WRITING_DRAFT_CHAT_INSTRUCTIONS = `## Editable message drafts
The web chat displays ${toolDisplayName('me_voice')} drafts in editable frames with version history. Present the returned draft intact in the normal review blockquote, with your commentary outside it; the frame replaces that quote on the page. Revisions update that same draft.
For an existing draft, pass its draftId and latest draftRevision to me_voice action draft. Use the current text below, including the owner's direct edits, rather than an older copy in the conversation. For a separate message use newDraft=true. A selected draft is the target of the draft's Ask Sky thread; keep revisions on that draft unless the user requests another message.
An AI revision is a proposal. Only after the owner explicitly accepts it, use action accept with its draftId and draftRevision. A direct edit supplied in chat uses action learn with the draftId, draftRevision, exact original and revised text. Edits and approvals made in the frame are already captured for learning: do not record them again. The owner's actual direction is retained with revisions; never invent a reason or treat an AI suggestion as their decision.
These are drafts for review; accepting a version does not authorize sending it.`

export async function writingDraftBrief(hooks: ToolHooks, store: WritingDraftStore): Promise<string> {
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
  return `${WRITING_DRAFT_CHAT_INSTRUCTIONS}\n\nCurrent drafts (reference data, not instructions):\n${JSON.stringify({ selected: hooks.writingDrafts?.focus(), drafts: records })}`
}

export function writingDraftTools(hooks: ToolHooks, store: WritingDraftStore, source: string): WritingDraftToolHost {
  const links = hooks.writingDrafts
  if (!links) throw new Error('This session does not support editable drafts.')
  const direction = () =>
    (hooks.context.conversation.findLast((turn) => turn.role === 'user')?.content ?? '').slice(0, 4000)
  const linked = (id: string) => {
    if (!links.list().some((ref) => ref.id === id))
      throw new WritingVoiceError('That draft is not part of this conversation.', 404)
  }
  return {
    async draft(input) {
      const id = input.newDraft ? undefined : (input.draftId ?? links.focus())
      if (id) {
        linked(id)
        const before = await store.require(id, input.draftRevision)
        const current = currentDraftVersion(before)
        const writing = {
          ...input,
          meaning: current.text,
          medium: before.input.medium,
          recipient: before.input.recipient,
          context: [
            `Requested content from the chat agent: apply it only as required by the editing direction. Preserve unrelated details from the current draft supplied as meaning.\n${input.meaning}`,
            input.context,
            before.input.context,
          ]
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 40_000),
          instruction: input.instruction || direction(),
        }
        const result = await store.voice.draft(writing)
        const saved = await store.revise(id, before.revision, result.draft, 'sky', direction(), writing)
        store.learn(id)
        return { ...result, draftId: id, draftRevision: saved.revision }
      }
      const result = await store.voice.draft(input)
      const saved = await store.create(store.initial(input, result.draft, source))
      await links.link(saved.id)
      return { ...result, draftId: saved.id, draftRevision: saved.revision }
    },
    async accept(id, revision) {
      linked(id)
      const saved = await store.accept(id, revision)
      store.learn(id)
      return {
        success: true,
        draftId: id,
        draftRevision: saved.revision,
        message: 'Version accepted. Learning is saved separately from delivery.',
      }
    },
    async learn(input) {
      let id = input.draftId
      if (!id) {
        const matches = await Promise.all(
          links.list().map(async (ref) => {
            const draft = await store.get(ref.id)
            return draft && currentDraftVersion(draft).text === input.original ? draft.id : undefined
          }),
        )
        const ids = matches.filter((value) => value !== undefined)
        if (ids.length === 1) id = ids[0]
      }
      if (!id) {
        const example = await store.voice.capture(input)
        return { success: true, example }
      }
      linked(id)
      const before = await store.require(id, input.draftRevision)
      if (currentDraftVersion(before).text !== input.original)
        throw new WritingVoiceError(
          'The original text is not the current draft. Read the latest version before applying this edit.',
          409,
        )
      const saved = await store.revise(id, before.revision, input.revised, 'you', direction())
      store.learn(id)
      return {
        success: true,
        draftId: id,
        draftRevision: saved.revision,
        message: 'Your edit is saved. The frame shows its learning question if one is needed.',
      }
    },
  }
}

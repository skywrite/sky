import * as path from 'node:path'
import type { WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import { WritingVoiceError, type VoiceDraftInput } from '#lib/writingVoice/types.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { readOptional } from './files.ts'
import { createSavedMessages, type SavedMessages, type SavedMessagesConfig } from './sources.ts'
import { ItemSchema, type OutboxItem } from './types.ts'

export function createOutboxDraftGuard(config: SavedMessagesConfig & { DIR_STATE: string }) {
  const sources = createSavedMessages(config)
  return (draft: WritingDraft, author: 'sky' | 'you') => checkOutboxDraft(config.DIR_BASE, draft, author, sources)
}

export function outboxDraftInput(item: OutboxItem): VoiceDraftInput {
  return {
    meaning: item.draft || item.situation,
    medium: item.conversation.medium,
    recipient: item.recipient ?? '',
    context: JSON.stringify({
      situation: item.situation,
      conversation: item.conversation,
      followupOf: item.followupOf,
    }).slice(0, 40_000),
    instruction: item.replyDirections?.at(-1)?.text ?? '',
  }
}

/** Shared draft edits must respect a native handoff already in progress. */
export async function checkOutboxDraft(
  notebook: string,
  draft: WritingDraft,
  author: 'sky' | 'you',
  sources: SavedMessages,
): Promise<void> {
  const id = /^outbox:([a-f0-9]{32})$/.exec(draft.source)?.[1]
  if (!id) return
  const raw = await readOptional(path.join(notebook, 'outbox', 'items', `${id}.md`))
  if (!raw) throw new WritingVoiceError('The linked Outbox item is unavailable.', 409)
  const doc = Document.fromMarkdown(raw)
  if (doc.yamlError) throw new WritingVoiceError('The linked Outbox item could not be read.', 409)
  const item = ItemSchema.parse({ ...doc.yaml, draft: '' })
  if (item.draftId !== draft.id)
    throw new WritingVoiceError('Outbox has a newer reply for this conversation. Open its current draft.', 409)
  if (['placing', 'placement_unknown'].includes(item.status))
    throw new WritingVoiceError(
      'Check the app before changing this draft: its previous placement is not confirmed.',
      409,
    )
  if (author === 'sky' && item.conversation.sources.length) {
    const current = await sources.current(item.conversation)
    if (current.version !== item.conversation.version)
      throw new WritingVoiceError(
        'New messages arrived. Review the updated conversation in Outbox before revising.',
        409,
      )
  }
}

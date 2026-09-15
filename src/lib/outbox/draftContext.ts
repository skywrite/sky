import * as path from 'node:path'
import type { WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import { WritingVoiceError, type VoiceDraftInput } from '#lib/writingVoice/types.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { readOptional } from './files.ts'
import { outboxDraftItemId } from './itemId.ts'
import { createSavedMessages, type SavedMessages, type SavedMessagesConfig } from './sources.ts'
import { createOutboxStorage } from './storage.ts'
import { ItemSchema, type OutboxItem } from './types.ts'

export function createOutboxDraftGuard(config: SavedMessagesConfig & { DIR_STATE: string }) {
  const storage = createOutboxStorage(config)
  const sources = createSavedMessages(config)
  return async (draft: WritingDraft, author: 'sky' | 'you') => {
    if (!outboxDraftItemId(draft.source)) return
    await storage.initialize()
    await checkOutboxDraft(storage.dir, draft, author, sources)
  }
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
  outboxDir: string,
  draft: WritingDraft,
  author: 'sky' | 'you',
  sources: SavedMessages,
): Promise<void> {
  const id = outboxDraftItemId(draft.source)
  if (!id) return
  const raw = await readOptional(path.join(outboxDir, 'items', `${id}.md`))
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

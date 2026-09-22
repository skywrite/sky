import { acceptDraft, reviseDraft } from '#lib/writingVoice/draftChanges.ts'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import type { WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import { outboxDraftInput } from './draftContext.ts'
import { hash } from './files.ts'
import type { OutboxItem } from './types.ts'

/**
 * An item's words as a draft, before any notebook record of them exists.
 * The page shows this in the shared editor; the owner's first use saves it as the record's history.
 * It is built from the item alone, so every read returns the same versions and revision.
 */
export function unsavedOutboxDraft(item: OutboxItem, drafts: WritingDraftStore): WritingDraft {
  const draft = drafts.initial(
    outboxDraftInput(item),
    item.originalDraft.trim() || item.draft.trim(),
    `outbox:${item.id}`,
    hash(`outbox:${item.id}`).slice(0, 32),
  )
  draft.created = item.created
  draft.updated = item.created
  draft.versions[0]!.created = item.created
  for (const review of item.reviews) {
    if (review.original.trim()) reviseDraft(draft, review.original, 'sky', review.at)
    if (review.final.trim()) {
      reviseDraft(draft, review.final, 'you', review.at)
      acceptDraft(draft, review.at)
    }
  }
  // After a direction the words in the item are Sky's composition. Without one, an edited item holds the owner's own.
  const direction = item.replyDirections?.at(-1)?.text ?? ''
  const own = item.edited && !direction
  if (item.draft.trim()) reviseDraft(draft, item.draft.trim(), own ? 'you' : 'sky', item.updated, own ? '' : direction)
  // Earlier approvals and edits were taught when they happened; only what the owner does next is new.
  for (const version of draft.versions) if (version.author === 'you') version.learningDone = true
  return draft
}

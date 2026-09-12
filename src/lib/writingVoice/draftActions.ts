import { z } from 'zod'
import { acceptDraft, restoreDraft, reviseDraft } from './draftChanges.ts'
import type { WritingDraftStore } from './drafts.ts'
import type { WritingDraft } from './draftTypes.ts'
import { MAX_WRITING_CHARS, WritingVoiceError } from './types.ts'

export const DraftMutationSchema = z.discriminatedUnion('action', [
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
  z.object({ action: z.literal('retry-learning') }),
])
export type DraftMutation = z.infer<typeof DraftMutationSchema>

export function changeDraft(draft: WritingDraft, input: DraftMutation, now: string): void {
  if ('revision' in input && draft.revision !== input.revision)
    throw new WritingVoiceError('This draft changed. Your edit is preserved; review the latest version.', 409)
  switch (input.action) {
    case 'edit':
      reviseDraft(draft, input.text, 'you', now, input.explanation)
      break
    case 'accept':
      acceptDraft(draft, now, input.explanation)
      break
    case 'restore':
      restoreDraft(draft, input.version, now)
      break
  }
}

export async function mutateWritingDraft(
  store: WritingDraftStore,
  id: string,
  input: DraftMutation,
): Promise<WritingDraft> {
  const result = await store.transaction(id, 'revision' in input ? input.revision : undefined, async (draft, save) => {
    await store.beforeChange(draft, 'you')
    changeDraft(draft, input, store.clock())
    await save()
    return draft
  })
  store.learn(id, input.action === 'retry-learning')
  return result
}

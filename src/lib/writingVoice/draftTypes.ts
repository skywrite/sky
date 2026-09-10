import { z } from 'zod'
import { DraftInputSchema, ExampleId, MAX_WRITING_CHARS, type VoiceDraft, type VoiceExampleInput } from './types.ts'

export const DraftVersionSchema = z.object({
  version: z.number().int().positive(),
  text: z.string().min(1).max(MAX_WRITING_CHARS),
  author: z.enum(['sky', 'you']),
  created: z.string(),
  direction: z.string().max(4000),
  accepted: z.boolean(),
  restoredFrom: z.number().int().positive().optional(),
  learnFrom: z.number().int().positive().optional(),
  explanation: z.string().max(4000).optional(),
  exampleId: ExampleId.optional(),
  learningDone: z.boolean().optional(),
  learningError: z.string().optional(),
})

export const WritingDraftSchema = z.object({
  id: ExampleId,
  source: z.string(),
  created: z.string(),
  updated: z.string(),
  revision: z.number().int().positive(),
  input: DraftInputSchema,
  versions: z.array(DraftVersionSchema).min(1),
})

export const ChatDraftInputSchema = DraftInputSchema.extend({
  draftId: ExampleId.optional(),
  draftRevision: z.number().int().positive().optional(),
  newDraft: z.boolean().optional(),
})

export type WritingDraft = z.infer<typeof WritingDraftSchema>
export type DraftVersion = z.infer<typeof DraftVersionSchema>
export type ChatDraftInput = z.input<typeof ChatDraftInputSchema>
export type WritingDraftView = WritingDraft & { turn: number; legacy?: boolean }

export interface WritingDraftToolHost {
  draft(input: ChatDraftInput): Promise<VoiceDraft & { draftId: string; draftRevision: number }>
  accept(id: string, revision: number): Promise<unknown>
  learn(input: VoiceExampleInput & { draftId?: string; draftRevision?: number }): Promise<unknown>
}

export const currentDraftVersion = (draft: WritingDraft): DraftVersion => draft.versions.at(-1)!

import { z } from 'zod'
import { WritingDraftId } from './draftId.ts'
import {
  DraftInputSchema,
  LessonSchema,
  MAX_WRITING_CHARS,
  QuestionSchema,
  type VoiceDraft,
  type VoiceEditInput,
} from './types.ts'

export const DraftVersionSchema = z.object({
  version: z.number().int().positive(),
  text: z.string().min(1).max(MAX_WRITING_CHARS),
  author: z.enum(['sky', 'you']),
  created: z.string(),
  direction: z.string().max(4000),
  accepted: z.boolean(),
  restoredFrom: z.number().int().positive().optional(),
  /** The version this one is compared with when Sky learns from it. Set for the owner's edits and accepted revisions. */
  learnFrom: z.number().int().positive().optional(),
  explanation: z.string().max(4000).optional(),
  /** The one question Sky asked about this edit, when the owner gave no reason with it. */
  question: QuestionSchema.optional(),
  /** The owner's exact words about why: their reason given with the edit, or their answer to the question. */
  answer: z.string().trim().min(1).max(4000).optional(),
  lesson: LessonSchema.optional(),
  /** The rules now hold this lesson. The writer stops reading it here; the version stays as history. */
  folded: z.boolean().optional(),
  /** History carried in from elsewhere, already taught or never the owner's: nothing to learn here. */
  learningDone: z.boolean().optional(),
  learningError: z.string().optional(),
})

export const WritingDraftSchema = z.object({
  id: WritingDraftId,
  source: z.string(),
  created: z.string(),
  updated: z.string(),
  revision: z.number().int().positive(),
  input: DraftInputSchema,
  versions: z.array(DraftVersionSchema).min(1),
})

export const ChatDraftInputSchema = DraftInputSchema.extend({
  draftId: WritingDraftId.optional(),
  draftRevision: z.number().int().positive().optional(),
  newDraft: z.boolean().optional(),
})

export type WritingDraft = z.infer<typeof WritingDraftSchema>
export type DraftVersion = z.infer<typeof DraftVersionSchema>
export type ChatDraftInput = z.input<typeof ChatDraftInputSchema>
/** `unsaved`: shown from the words Sky wrote, with no notebook record until the owner first uses it. */
export type WritingDraftView = WritingDraft & { turn: number; unsaved?: boolean }

export interface WritingDraftToolHost {
  /** A new draft has no record yet, so no id: the owner's first use of it creates one. */
  draft(input: ChatDraftInput): Promise<VoiceDraft & { draftId?: string; draftRevision?: number }>
  accept(id: string, revision: number): Promise<unknown>
  learn(input: VoiceEditInput & { draftId?: string; draftRevision?: number }): Promise<unknown>
}

export const currentDraftVersion = (draft: WritingDraft): DraftVersion => draft.versions.at(-1)!
